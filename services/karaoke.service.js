import 'dotenv/config';
import fs from 'fs';
import path from 'path';
// 1) Importa slugify si no lo tienes, o reúsalo dentro:
import slugify from 'slugify';

import GithubService from '#services/github.service.js';
import ChromaService from '#services/chroma.service.js';
import AIService from '#services/ai.service.js';
import SunoService from '#services/suno.service.js';
import UploadService from '#services/upload.service.js';

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

class KaraokeService {
	// Aproximación simple: 4 caracteres ~ 1 token. Ajusta si deseas un cálculo más fino.
	static chunkTextByTokens(text, maxTokens = 3000) {
		const approxCharsPerToken = 4;
		const maxChars = maxTokens * approxCharsPerToken;

		const chunks = [];
		let startIndex = 0;

		while(startIndex < text.length) {
			const endIndex = Math.min(startIndex + maxChars, text.length);
			const chunk = text.slice(startIndex, endIndex);
			chunks.push(chunk);
			startIndex = endIndex;
		}
		return chunks;
	}

	static async handleSunoCallbackLyrics(callbackData) {
		try {
			// SUPER LOG LLAMATIVO
			console.log(`
===================================================
=                                                 =
=    🎤  [KaraokeService] LYRICS CALLBACK DEBUG    =
=                                                 =
===================================================
${ JSON.stringify(callbackData, null, 2) }
===================================================
`);

			if(!callbackData || !callbackData.data) {
				throw new Error('Invalid callback data (no "data" field)');
			}

			const sunoTaskId = callbackData.data.task_id;
			const callbackType = callbackData.data.callbackType || 'lyrics';

			// Busca la canción en la DB (si estás relacionando la misma suno_task_id que en audio):
			const songRecord = await prisma.song.findUnique({
				where: { suno_task_id: sunoTaskId },
			});

			if(!songRecord) {
				console.warn(`⚠️ [KaraokeService] No Song record found for suno_task_id: ${ sunoTaskId }`);
			} else {
				// Si Suno enviara letras más refinadas, por ejemplo en callbackData.data.lyrics:
				const improvedLyrics = callbackData.data.lyrics;
				if(improvedLyrics) {
					console.log('🎶 [KaraokeService] Updating song with improved lyrics from callback...');
					await prisma.song.update({
						where: { id: songRecord.id },
						data: { lyrics: improvedLyrics },
					});
				}

				// Si deseas registrar un "estado de lyrics" en la canción (opcional):
				// await prisma.song.update({
				//   where: { id: songRecord.id },
				//   data: { status: 'lyrics_ready' },
				// });
			}

			return {
				status: 'success',
				taskId: sunoTaskId,
				callbackType,
				message: 'Lyrics callback processed successfully',
			};
		} catch(error) {
			console.error('❌ [KaraokeService] Error handling Suno lyrics callback:', error);
			throw new Error(`Error handling Suno lyrics callback: ${ error.message }`);
		}
	}

	/**
	 * Main function to generate a song from a GitHub repository.
	 */
	static async generateSongFromRepo(options) {
		try {
			console.log('🎵 [KaraokeService] Starting song generation from repository');

			const {
				repoUrl,
				timeRange = 'week',
				startDate,
				endDate,
				musicStyle = 'Rock',
				instrumental = false,
				callbackUrl,
			} = options;

			if(!repoUrl) {
				throw new Error('Repository URL is required');
			}
			if(!callbackUrl) {
				throw new Error('Callback URL is required for Suno API');
			}

			// 1. Extract repository info
			console.log('🔍 Extracting repository information');
			const { owner, repo } = GithubService.extractRepoInfoFromUrl(repoUrl);

			// 2. Fetch commits
			console.log(`📅 Fetching commits for ${ timeRange } timeframe`);
			let commits;
			if(timeRange === 'day') {
				commits = await GithubService.getCommitsForToday(owner, repo);
			} else if(timeRange === 'week') {
				commits = await GithubService.getCommitsForThisWeek(owner, repo);
			} else if(timeRange === 'custom' && startDate && endDate) {
				commits = await GithubService.getCommitsInCustomInterval(owner, repo, startDate, endDate);
			} else if(timeRange === 'lastActivity') {
				// NUEVO BLOQUE para “última actividad”
				commits = await GithubService.getCommitsByLastActivity(owner, repo);
			} else {
				throw new Error('Invalid time range or missing dates for custom range');
			}

			if(commits.length === 0) {
				throw new Error('No commits found in the specified time range');
			}
			console.log(`✅ Found ${ commits.length } commits`);

			// 3. Format commits for analysis
			console.log('🔄 Formatting commits for analysis');
			const formattedCommits = await GithubService.formatCommitsForAnalysis(owner, repo, commits);

			// 4. Summarize commits
			console.log('📊 Creating commit summary');
			const commitSummary = GithubService.summarizeCommits(owner, repo, formattedCommits);

			// 5. Store commit data in Chroma for embeddings
			console.log('💾 Storing commit data in ChromaDB');
			const collectionName = `github_commits_${ owner }_${ repo }`.replace(/[^\w]/g, '_');

			// Uso de la función que sí setea la embeddingFunction en la colección
			const collection = await ChromaService.createOrGetCollectionUsingEmbeddings(
				collectionName,
				'openai',
				'text-embedding-ada-002',
			);

			// 5a. Upsert each commit into Chroma
			const commitDocs = formattedCommits.map(commit => {
				const fileChanges = commit.files
					.map(file => `File: ${ file.filename } (${ file.status }) - Added: ${ file.additions }, Deleted: ${ file.deletions }\n${ file.patch || '' }`)
					.join('\n\n');

				return {
					id: commit.sha,
					text: `Commit: ${ commit.sha }\nAuthor: ${ commit.author.name } <${ commit.author.email }>\nDate: ${ commit.date }\nMessage: ${ commit.message }\n\nChanges:\n${ fileChanges }`,
					metadata: {
						sha: commit.sha,
						author: `${ commit.author.name } <${ commit.author.email }>`,
						date: commit.date,
						message: commit.message,
						stats: commit.stats,
					},
				};
			});

			// 5a. Upsert each commit into Chroma
			for(const doc of commitDocs) {
				// 1) Obtener chunks
				const chunks = KaraokeService.chunkTextByTokens(doc.text, 3000);

				// 2) Por cada chunk, generar embeddings y guardarlo con un ID distinto
				for(let i = 0; i < chunks.length; i++) {
					const chunk = chunks[i];

					// Genera embeddings de ESTE chunk
					const embeddings = await ChromaService.generateEmbeddings([ chunk ]);

					// Crea un ID distinto por chunk (ej. commitSha__chunk0, chunk1, etc.)
					const chunkId = `${ doc.id }__chunk_${ i }`;

					await ChromaService.upsertDocuments(
						collection,
						[ chunk ],        // el texto para Chroma
						[ chunkId ],      // nuevo ID
						embeddings,
						[ doc.metadata ], // si quieres repetir la metadata (o ajustarla si deseas)
					);
				}
			}

			// 6. Generate a search query in plain language
			console.log('🤖 Generating system prompt for AI');
			const systemPrompt = `
        You are an assistant specialized in analyzing code commits and providing short, plain text queries for a vector database (Chroma).
        You MUST respond in valid JSON only, without additional text.
        
        Task:
        Given this repo context:
        - Name: ${ commitSummary.repositoryName }
        - Time period: ${ new Date(commitSummary.timeRange.start).toLocaleDateString() } to ${ new Date(commitSummary.timeRange.end).toLocaleDateString() }
        - Total commits: ${ commitSummary.commitCount }
        - Top contributors: ${
				commitSummary.authors
					.slice(0, 3)
					.map(a => `${ a.name } (${ a.count } commits)`)
					.join(', ')
			}
        
        And the most changed files: ${
				commitSummary.mostChangedFiles
					.slice(0, 5)
					.map(file => `${ file.filename } (${ file.changes } changes)`)
					.join(', ')
			}
        
        Please return a JSON object with the structure:
        {
          "searchQuery": "some short plain text describing what user might want to find"
        }

        IMPORTANT:
        - Do NOT use advanced operators like "repo:" or "author:" or "path:" or any symbolic plus signs.
        - Provide a short description in natural English, e.g. "commits about bug fixes and significant features"
      `;

			console.log('🔍 Generating search query with AI');
			const aiResponse = await AIService.sendMessage({
				model: 'gpt-4-turbo-preview',
				system: systemPrompt,
				prompt: 'Generate a plain text searchQuery in JSON for relevant commits.',
				temperature: 0.7,
				responseFormat: { type: 'json_object' },
			});

			// Parse searchQuery from JSON
			let searchQuery = '';
			try {
				const raw = aiResponse.choices[0].message.content;
				const parsed = JSON.parse(raw);
				searchQuery = parsed.searchQuery || '';
			} catch(err) {
				console.error('Failed to parse JSON for searchQuery:', err);
				searchQuery = aiResponse.choices[0].message.content; // fallback
			}

			// 6b. Clean up the query to avoid weird characters
			const sanitizedQuery = searchQuery.replace(/[^\p{L}\p{N}\p{Z}]+/gu, ' ').trim();
			console.log('📝 Final search query:', sanitizedQuery);

			// 7. Query Chroma
			console.log('🔎 Searching for relevant commits in Chroma');
			const searchResults = await ChromaService.queryCollection(collection, [ sanitizedQuery ], 5);

			// 8. Prepare context from search results
			console.log('📄 Preparing context from search results');
			const commitContext = searchResults.documents[0].map((doc, idx) => {
				const metadata = searchResults.metadatas[0][idx];
				return `
Commit: ${ metadata.sha }
Author: ${ metadata.author }
Date: ${ metadata.date }
Message: ${ metadata.message }

Changes:
${ doc.substring(doc.indexOf('Changes:') + 8) }
        `;
			}).join('\n\n------\n\n');

			// 9. Generate song lyrics in JSON
			console.log('🎤 Generating song lyrics with AI');
			const lyricsSystemPrompt = `
        You are a creative songwriter focusing on software development.
        You MUST respond in valid JSON only. No extra text.

        Task:
        Write lyrics about these recent commits in the repository, referencing specific changes, using some technical terms,
        and capturing emotional aspects (frustration, triumph, late nights).

        Provide a JSON object like:
        {
          "lyrics": "Full song lyrics here"
        }

        Important commits:
        ${ commitContext }
      `;

			const lyricsResponse = await AIService.sendMessage({
				model: 'gpt-4-turbo-preview',
				system: lyricsSystemPrompt,
				prompt: `Write a ${ musicStyle } style song in JSON about these commits.`,
				temperature: 0.8,
				responseFormat: { type: 'json_object' },
			});

			let songLyrics = '';
			try {
				const raw = lyricsResponse.choices[0].message.content;
				const parsed = JSON.parse(raw);
				songLyrics = parsed.lyrics || '';
			} catch(err) {
				console.error('Failed to parse JSON for song lyrics:', err);
				songLyrics = lyricsResponse.choices[0].message.content; // fallback
			}

			console.log('✍️ Generated song lyrics:', songLyrics);

			// 10. Generate a short, catchy song title in JSON
			console.log('🏷️ Generating song title');
			const titleSystemPrompt = `
        You are a creative title generator for songs about software development.
        Respond in valid JSON only, with structure:
        {
          "title": "Catchy short title"
        }
      `;
			const titlePrompt = `
        Based on these lyrics, generate a short and catchy song title:
        "${ songLyrics.substring(0, 300) }..."
      `;

			const titleResponse = await AIService.sendMessage({
				model: 'gpt-4-turbo-preview',
				system: titleSystemPrompt,
				prompt: titlePrompt,
				temperature: 0.8,
				max_tokens: 25,
				responseFormat: { type: 'json_object' },
			});

			let songTitle = 'Untitled Song';
			try {
				const raw = titleResponse.choices[0].message.content;
				const parsed = JSON.parse(raw);
				songTitle = parsed.title || 'Untitled Song';
			} catch(err) {
				console.error('Failed to parse JSON for song title:', err);
				songTitle = titleResponse.choices[0].message.content.replace(/"/g, '').trim();
			}

			console.log('🎵 Generated song title:', songTitle);

			// 11. Send to Suno
			console.log('🎹 Generating final audio with Suno API');
			let songGenerationResponse;

			if(instrumental) {
				// Just generate an instrumental
				songGenerationResponse = await SunoService.generateAudio({
					prompt: `A ${ musicStyle } song about code and software development`,
					style: musicStyle,
					title: songTitle,
					customMode: true,
					instrumental: true,
					model: 'V3_5',
					callBackUrl: callbackUrl,
				});
			} else {
				// 1) Send lyrics to Suno
				console.log('🎤 Sending lyrics to Suno API for better formatting');
				await SunoService.generateLyrics({
					prompt: songLyrics,
					callBackUrl: `${ callbackUrl }/karaoke/callback/lyrics`,
				});
				// 2) Then generate full audio
				songGenerationResponse = await SunoService.generateAudio({
					prompt: songLyrics,
					style: musicStyle,
					title: songTitle,
					customMode: true,
					instrumental: false,
					model: 'V3_5',
					callBackUrl: callbackUrl + '/karaoke/callback',
				});
			}

			// Aseguramos que la respuesta contenga data y taskId
			if(!songGenerationResponse || !songGenerationResponse.data) {
				console.error('❌ SunoService response:', songGenerationResponse);
				throw new Error('No "data" found in response from SunoService.generateAudio()');
			}
			if(!songGenerationResponse.data.taskId) {
				console.error('❌ "taskId" missing in response data:', songGenerationResponse.data);
				throw new Error('No "taskId" found in SunoService response data');
			}

			const sunoTaskId = songGenerationResponse.data.taskId;
			console.log('🎉 Song generation task initiated with ID:', sunoTaskId);
			const coverPrompt = `Genera una imagen que represente el titulo de la cancion "${ songTitle }" en un estilo comico sin incluir ninguna palabras olo una imagen mnuy graciosa representativa del nombre de la cacnion y del estilo de musica "${ musicStyle }".`.trim();
			console.log('🖼️ [DEBUG] Iniciando generación de imagen con prompt:', coverPrompt);
			let coverAttachment = null;  // Declarada fuera del try

			try {
				coverAttachment = await AIService.generateCoverImage(coverPrompt, {
					size: '512x512',
					model: 'dall-e-2',
				});
				console.log('✅ [DEBUG] Imagen generada y guardada con éxito:', coverAttachment);
			} catch(error) {
				console.error('❌ [DEBUG] Error al generar o guardar la imagen:', error.message);
				throw error;
			}

			console.log('💽 [KaraokeService] Storing new song record in DB...');

			console.log('💽 [KaraokeService] Storing new song record in DB...');

			// [Opcional] Guardar en DB la canción con status pending
			// Ejemplo: crear un registro en la tabla Song con suno_task_id, etc.
			console.log('💽 [KaraokeService] Storing new song record in DB...');
			// imprime
			console.log('MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMETAS', coverAttachment.metas);
			// IMAGEN QUE GUARDAM;OS
			console.log('MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMETAS', coverAttachment.metas?.location);
			const newSong = await prisma.song.create({
				data: {
					title: songTitle,
					lyrics: songLyrics,
					style: musicStyle,
					instrumental,
					suno_task_id: sunoTaskId,
					cover_image_url: coverAttachment?.metas?.location || null,
					status: 'pending',
					repository: {
						connect: {
							// Ajustar según tu DB
							id: await this.#findOrCreateRepoId(owner, repo, repoUrl),
						},
					},
					time_range: {
						start: commitSummary.timeRange.start,
						end: commitSummary.timeRange.end,
					},
					commit_count: commitSummary.commitCount,
					prompt: songLyrics, // o el prompt real que quieras guardar
				},
			});

			console.log('✅ [KaraokeService] Song record created:', newSong.id);

			return {
				status: 'success',
				repository: {
					owner,
					repo,
					url: repoUrl,
				},
				commitStats: {
					total: commitSummary.commitCount,
					timeRange: {
						start: commitSummary.timeRange.start,
						end: commitSummary.timeRange.end,
					},
				},
				song: {
					title: songTitle,
					lyrics: songLyrics,
					taskId: sunoTaskId,
					instrumental,
				},
			};
		} catch(error) {
			console.error('❌ [KaraokeService] Error generating song from repo:', error.message);
			throw new Error(`Error generating song from repository: ${ error.message }`);
		}
	}

	/**
	 * Process the callback from Suno API and save the generated song,
	 * then upload to DigitalOcean using UploadService.
	 */
	static async handleSunoCallback(callbackData) {
		try {
			console.log('📞 [KaraokeService] Received Suno callback');
			console.log('[DEBUG] callbackData:', JSON.stringify(callbackData, null, 2));

			if(!callbackData || !callbackData.data) {
				throw new Error('Invalid callback data (no "data" field)');
			}

			// 1. Descarga los archivos con SunoService
			console.log('💾 [KaraokeService] Downloading song files from callback...');
			const savedFiles = await SunoService.downloadAndSaveSongFromCallback(callbackData);
			console.log('📝 [KaraokeService] Files saved:', savedFiles);

			const sunoTaskId = callbackData.data.task_id;
			const callbackType = callbackData.data.callbackType || '';

			// 2. Localizar la Song en la DB
			const songRecord = await prisma.song.findUnique({
				where: { suno_task_id: sunoTaskId },
			});

			if(!songRecord) {
				console.warn('⚠️ [KaraokeService] No Song record found for suno_task_id:', sunoTaskId);
			} else {
				// Si el callback marca 'complete', pasamos la canción a status=completed
				if(callbackType === 'complete') {
					console.log('✅ [KaraokeService] Marking Song as completed');
					await prisma.song.update({
						where: { id: songRecord.id },
						data: { status: 'completed', completed_at: new Date() },
					});
				} else {
					console.log(`ℹ️ [KaraokeService] Callback type: ${ callbackType }. Not marking as complete yet.`);
				}
			}

			// 3. Procesar cada track devuelto en savedFiles
			const doAttachments = [];
			for(const info of savedFiles) {
				// 3a) Si tenemos filePath, significa que SÍ guardaste en disco local
				if(info.filePath) {
					const fileBuffer = fs.readFileSync(info.filePath);
					const mimeType = 'audio/mpeg';

					// slugificar el título, por ejemplo:
					const safeTitle = slugify(songRecord.title, { lower: true, strict: true });
					// Ojo: si no quieres tildes, acentos, etc., "strict: true" elimina símbolos raros

					const uploadFile = {
						// Aquí cambias originalname:
						originalname: `${ safeTitle }.mp3`,   // o con guiones, etc.
						mimetype: mimeType,
						buffer: fileBuffer,
						size: fileBuffer.length,
					};

					// Subida a DO
					const attachment = await UploadService.createAttachment(uploadFile);
					console.log('✅ [KaraokeService] Uploaded to DO. URL:', attachment.url);
					doAttachments.push(attachment);

					// Creamos el audioFile si existe la canción
					if(songRecord) {
						await prisma.audioFile.create({
							data: {
								filename: attachment.slug,
								url: attachment.url,
								file_type: 'mp3',
								mime_type: attachment.mime,
								is_vocal: true,
								is_original: true,
								song_id: songRecord.id,
								attachment_id: attachment.id,
							},
						});
					}

				} else {
					// 3b) No hay filePath, pero en savedFiles debe venir 'attachment' ya creado (u otra info).
					const { trackInfo, attachment } = info;

					if(!attachment) {
						console.warn('⚠️ [KaraokeService] Neither filePath nor attachment found for:', info);
						continue;
					}

					console.log('🔗 [KaraokeService] We already have an attachment from SunoService:', attachment.url);
					doAttachments.push(attachment);

					// De nuevo, si la canción existe, creamos su audioFile
					if(songRecord) {
						await prisma.audioFile.create({
							data: {
								filename: attachment.slug || `${ attachment.id }.mp3`,
								url: attachment.url,
								file_type: 'mp3',
								mime_type: attachment.mime || 'audio/mpeg',
								is_vocal: true,
								is_original: true,
								song_id: songRecord.id,
								attachment_id: attachment.id,
								// Opcional: si quieres guardar el ID de Suno en audioFile
								suno_audio_id: trackInfo?.id || null,
							},
						});
					}
				}
			}

			return {
				status: 'success',
				taskId: sunoTaskId,
				callbackType,
				savedFiles,
				doAttachments,
			};
		} catch(error) {
			console.error('❌ [KaraokeService] Error handling Suno callback:', error);
			throw new Error(`Error handling Suno callback: ${ error.message }`);
		}
	}

	/**
	 * Check the status of a song generation task in Suno, with extra logs.
	 */
	static async checkSongStatus(taskId) {
		try {
			console.log(`🔍 [KaraokeService] Checking status of song task: ${ taskId }`);
			console.log('🌐 [KaraokeService] Calling SunoService.getTaskDetails with disableCache: true');

			const taskDetails = await SunoService.getTaskDetails(taskId, { disableCache: true });
			console.log('[DEBUG] Suno task details:', JSON.stringify(taskDetails, null, 2));

			return {
				status: 'success',
				taskId,
				songStatus: taskDetails.data.status,
				details: taskDetails.data,
			};
		} catch(error) {
			console.error('❌ [KaraokeService] Error checking song status:', error.message);
			throw new Error(`Error checking song status: ${ error.message }`);
		}
	}

	/**
	 * Wait for a song generation task to complete in Suno, with extra logs.
	 */
	static async waitForSongCompletion(taskId, maxAttempts = 60, interval = 5000) {
		try {
			console.log(`⏳ [KaraokeService] Waiting for song completion: ${ taskId }`);
			let attempts = 0;

			const poll = async () => {
				console.log(`🔄 [KaraokeService] Polling attempt ${ attempts + 1 }/${ maxAttempts } for taskId=${ taskId }`);
				const taskDetails = await SunoService.getTaskDetails(taskId, { disableCache: true });
				console.log('[DEBUG] Polled status:', JSON.stringify(taskDetails, null, 2));

				const status = taskDetails?.data?.status || 'UNKNOWN';

				if(status === 'SUCCESS') {
					console.log('🎉 [KaraokeService] Song generation success for task:', taskId);
					return taskDetails;
				}
				if(status.includes('FAILED') || status.includes('ERROR')) {
					throw new Error(`Song generation failed with status: ${ status }`);
				}

				attempts++;
				if(attempts >= maxAttempts) {
					throw new Error(`Song did not complete after ${ maxAttempts } attempts`);
				}

				await new Promise(resolve => setTimeout(resolve, interval));
				return poll();
			};

			const completedTask = await poll();
			console.log('✅ [KaraokeService] Song generation completed for taskId:', taskId);
			return {
				status: 'success',
				taskId,
				songStatus: completedTask.data.status,
				details: completedTask.data,
			};
		} catch(error) {
			console.error('❌ [KaraokeService] Error waiting for song completion:', error.message);
			throw new Error(`Error waiting for song completion: ${ error.message }`);
		}
	}

	/**
	 * Helper: find or create a repository ID for the given (owner,repo).
	 * Adjust logic as needed for your DB structure.
	 */
	static async #findOrCreateRepoId(owner, repo, url) {
		// Chequea si ya existe
		let existing = await prisma.repository.findUnique({
			where: { full_name: `${ owner }/${ repo }` },
		});
		if(!existing) {
			existing = await prisma.repository.create({
				data: {
					owner,
					name: repo,
					full_name: `${ owner }/${ repo }`,
					url,
					description: '',
					created_at: new Date(),
					updated_at: new Date(),
				},
			});
			console.log('🆕 [KaraokeService] Created new repository record:', existing.id);
		}
		return existing.id;
	}
}

export default KaraokeService;
