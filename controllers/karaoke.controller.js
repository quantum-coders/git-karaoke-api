// karaoke.controller.js
import primate from '@thewebchimp/primate';
import KaraokeService from '#services/karaoke.service.js';

/**
 * Controlador "KaraokeController" sin usuarios.
 * Ofrece:
 *  - Creación de canciones (POST /karaoke)
 *  - Listado con paginación y búsqueda (GET /karaoke)
 *  - Detalle de una canción (GET /karaoke/:songId)
 *  - Callback de Suno (POST /karaoke/callback)
 *  - Chequear tarea (GET /karaoke/tasks/:taskId)
 *  - Estilos musicales (GET /karaoke/styles)
 *  - Config global (GET /karaoke/config)
 *  - Estadísticas (GET /karaoke/stats)
 *  - Detalle extendido (GET /karaoke/:songId/detailed)
 */

class KaraokeController {
	/**
	 * GET /karaoke/styles
	 * Devuelve un listado de estilos musicales.
	 */
	static async getAvailableStyles(req, res) {
		try {
			// Lista muy amplia de estilos musicales
			const styles = [
				'Rock', 'Pop', 'Hip-Hop', 'Rap', 'Reggaeton', 'Electronic', 'Classical',
				'Jazz', 'Blues', 'Country', 'Folk', 'Metal', 'Punk', 'Alternative', 'Indie',
				'Funk', 'Soul', 'R&B', 'Disco', 'House', 'Techno', 'Trance', 'Dubstep', 'Ambient',
				'Industrial', 'Experimental', 'Ska', 'Gospel', 'Latin', 'Dance', 'World', 'Reggae',
				'K-Pop', 'J-Pop', 'Fado', 'Cumbia', 'Salsa', 'Bachata', 'Merengue', 'Zouk',
				'Afrobeat', 'Highlife', 'Jungle', 'Drum & Bass', 'Trap', 'Electro', 'Synthpop',
				'New Wave', 'Grunge', 'Progressive Rock', 'Psychedelic Rock', 'Lo-fi', 'Chillhop',
				'Tribal', 'Orchestral', 'Acoustic', 'Ambient Pop', 'Alternative R&B', 'Dub',
				'Hard Rock', 'Post-Punk', 'Emo', 'Shoegaze', 'Noise', 'Neo-Soul', 'Bossa Nova',
				'Samba', 'Bollywood', 'World Fusion', 'Experimental Electronic', 'Future Bass',
				'Breakbeat', 'Bassline', 'Drill', 'Lo-fi Hip-Hop', 'Chillwave', 'Vaporwave',
				'Synthwave', 'Electropop', 'Electro Swing', 'Tropical House', 'Moombahton',
				'Garage', 'UK Funky', 'Disco House', 'Nu-Disco', 'Deep House', 'Progressive House',
				'Tech House', 'Electro House', 'Bass House', 'Future House', 'Big Room',
				'Hardstyle', 'Happy Hardcore', 'Gabber', 'Melodic Dubstep', 'Future Garage',
				'Glitch Hop', 'IDM', 'Ambient Techno', 'Downtempo', 'Chillout', 'Balearic Beat',
				'Meditative', 'Cinematic', 'Ethnic', 'Polka', 'March', 'Opera', 'Baroque',
				'Renaissance', 'Contemporary Classical',
			];

			return res.respond({
				data: styles,
				message: 'List of available music styles',
			});
		} catch(error) {
			console.error('❌ getAvailableStyles error:', error);
			return res.respond({
				status: 500,
				message: `Failed to retrieve styles: ${ error.message }`,
			});
		}
	}

	/**
	 * GET /karaoke/config
	 * Devuelve configuración global. (Ejemplo)
	 */
	static async getGlobalConfig(req, res) {
		try {
			// Si guardas config en DB (AppSetting), podrías leerla aquí.
			// Ejemplo “hardcodeado”:
			const globalConfig = {
				defaultInstrumental: false,
				maxCommits: 50,
				defaultModel: 'gpt-4-turbo-preview',
			};

			return res.respond({
				data: globalConfig,
				message: 'Global karaoke config',
			});
		} catch(error) {
			console.error('❌ getGlobalConfig error:', error);
			return res.respond({
				status: 500,
				message: `Failed to retrieve config: ${ error.message }`,
			});
		}
	}

	/**
	 * POST /karaoke
	 * Crea una nueva canción (Song) usando KaraokeService.
	 * Body:
	 * {
	 *   "repoUrl": "https://github.com/owner/repo",
	 *   "timeRange": "week", // "day", "week", "custom"
	 *   "startDate": "2023-01-01",
	 *   "endDate": "2023-01-31",
	 *   "musicStyle": "Rock",
	 *   "instrumental": false
	 * }
	 */
	static async createSongFromRepo(req, res) {
		try {
			const {
				repoUrl,
				timeRange,
				startDate,
				endDate,
				musicStyle,
				instrumental,
			} = req.body || {};

			// Validación mínima
			if(!repoUrl || !timeRange) {
				return res.respond({
					status: 400,
					message: 'Missing required fields: repoUrl or timeRange',
				});
			}

			// Callback URL
			const callbackUrl = `${ process.env.CALLBACK_URL }`;

			// Llamada al service
			const songResult = await KaraokeService.generateSongFromRepo({
				repoUrl,
				timeRange,
				startDate: startDate ? new Date(startDate) : null,
				endDate: endDate ? new Date(endDate) : null,
				musicStyle: musicStyle || 'Pop',
				instrumental: Boolean(instrumental),
				callbackUrl,
			});

			return res.respond({
				data: songResult,
				message: 'Song generation started successfully',
			});
		} catch(error) {
			console.error('❌ createSongFromRepo error:', error);
			return res.respond({
				status: 500,
				message: `Failed to create song: ${ error.message }`,
			});
		}
	}

	/**
	 * GET /karaoke
	 * Devuelve TODAS las canciones con búsqueda, filtros y paginación.
	 * Query params:
	 *  - search? => busca en title o lyrics
	 *  - status? => filtra por status
	 *  - instrumental? => "true" o "false"
	 *  - limit? => default 10
	 *  - offset? => default 0
	 *  - orderBy? => "title", "status", "created_at", ...
	 *  - orderDir? => "asc" o "desc"
	 */
	// karaoke.controller.js

	static async getAllSongs(req, res) {
		try {
			// 1. Leer query params
			const {
				search,
				status,
				instrumental,
				limit = 10,
				offset = 0,
				orderBy = 'created_at',
				orderDir = 'desc',
			} = req.query;

			// 2. Construir where
			const whereClause = {};

			if(search) {
				// Busca en título o en lyrics
				whereClause.OR = [
					{ title: { contains: search, mode: 'insensitive' } },
					{ lyrics: { contains: search, mode: 'insensitive' } },
				];
			}
			if(status) {
				whereClause.status = status;
			}
			if(instrumental === 'true') {
				whereClause.instrumental = true;
			} else if(instrumental === 'false') {
				whereClause.instrumental = false;
			}

			// 3. Determinar orderBy
			const validColumns = [ 'title', 'status', 'created_at', 'updated_at', 'style' ];
			const sortColumn = validColumns.includes(orderBy) ? orderBy : 'created_at';
			const sortDir = orderDir === 'asc' ? 'asc' : 'desc';

			// 4. Contar total para la paginación
			const totalCount = await primate.prisma.song.count({ where: whereClause });

			// 5. Obtener los registros enriquecidos, incluyendo repository, audio_files y analysis_tasks
			const songs = await primate.prisma.song.findMany({
				where: whereClause,
				orderBy: { [sortColumn]: sortDir },
				skip: parseInt(offset, 10),
				take: parseInt(limit, 10),
				include: {
					repository: true,        // Datos del repositorio
					audio_files: true,       // Archivos de audio asociados
					analysis_tasks: true,    // Tareas de análisis relacionadas
				},
			});

			// 6. Respuesta
			return res.respond({
				data: songs,
				message: `Found ${ songs.length } songs`,
				meta: {
					total: totalCount,
					limit: parseInt(limit, 10),
					offset: parseInt(offset, 10),
					orderBy: sortColumn,
					orderDir: sortDir,
				},
			});
		} catch(error) {
			console.error('❌ getAllSongs error:', error);
			return res.respond({
				status: 500,
				message: `Failed to retrieve songs: ${ error.message }`,
			});
		}
	}

	/**
	 * GET /karaoke/:songId
	 * Devuelve una sola canción (por ID), con sus audio_files (si deseas).
	 */
	static async getSongById(req, res) {
		try {
			let { songId } = req.params;
			if(!songId) {
				return res.respond({
					status: 400,
					message: 'Missing parameter: songId',
				});
			}

			// Convierte a número y valida
			const songIdNum = parseInt(songId, 10);
			if(Number.isNaN(songIdNum) || songIdNum <= 0) {
				return res.respond({
					status: 400,
					message: 'Invalid parameter: songId must be a positive integer',
				});
			}

			// Consulta en Prisma
			const song = await primate.prisma.song.findUnique({
				where: { id: songIdNum },
				include: {
					audio_files: true,
				},
			});

			if(!song) {
				return res.respond({
					status: 404,
					message: 'Song not found',
				});
			}

			return res.respond({
				data: song,
				message: 'Song retrieved successfully',
			});
		} catch(error) {
			console.error('❌ getSongById error:', error);
			return res.respond({
				status: 500,
				message: `Failed to get song: ${ error.message }`,
			});
		}
	}

	/**
	 * POST /karaoke/callback
	 * Callback para cuando se complete la generación de audio (Suno).
	 */
	static async handleSunoCallback(req, res) {
		try {
			const callbackData = req.body;
			const result = await KaraokeService.handleSunoCallback(callbackData);

			return res.respond({
				data: result,
				message: 'Callback processed successfully',
			});
		} catch(error) {
			console.error('❌ handleSunoCallback error:', error);
			return res.respond({
				status: 500,
				message: `Failed to process callback: ${ error.message }`,
			});
		}
	}

	/**
	 * GET /karaoke/tasks/:taskId
	 * Consulta el estado de una tarea (generada en KaraokeService).
	 */
	static async checkSongTaskStatus(req, res) {
		try {
			const { taskId } = req.params;
			if(!taskId) {
				return res.respond({
					status: 400,
					message: 'Missing parameter: taskId',
				});
			}

			const statusResult = await KaraokeService.checkSongStatus(taskId);

			return res.respond({
				data: statusResult,
				message: 'Task status retrieved successfully',
			});
		} catch(error) {
			console.error('❌ checkSongTaskStatus error:', error);
			return res.respond({
				status: 500,
				message: `Failed to check task status: ${ error.message }`,
			});
		}
	}

	/**
	 * GET /karaoke/stats
	 * Devuelve estadísticas generales de las canciones (p.ej. cuántas completadas).
	 */
	static async getKaraokeStats(req, res) {
		try {
			const totalSongs = await primate.prisma.song.count();
			const completed = await primate.prisma.song.count({
				where: { status: 'completed' },
			});
			const failed = await primate.prisma.song.count({
				where: { status: 'failed' },
			});

			// Con Primate, supongamos que res.respond funciona así:
			return res.respond(200, {
				data: { totalSongs, completed, failed },
			});
		} catch(error) {
			console.error('[getKaraokeStats] Error:', error);
			return res.respond(400, { error: error.message });
		}
	}

	/**
	 * GET /karaoke/:songId/detailed
	 * Retorna datos extendidos de la canción, incluyendo repository, audio_files,
	 * analysis_tasks y commits (según la time_range).
	 */
	// karaoke.controller.js
	static async getSongDetailed(req, res) {
		try {
			const { songId } = req.params;
			if(!songId) {
				return res.respond({
					status: 400,
					message: 'Missing parameter: songId',
				});
			}

			// 1. Buscar la canción con todo lo que podamos incluir directamente
			const song = await primate.prisma.song.findUnique({
				where: { id: parseInt(songId, 10) },
				include: {
					repository: true, // trae info del repo
					audio_files: {
						// aquí anidamos la relación con attachments
						include: {
							attachment: true, // <- para traer el objeto "attachment" de la tabla
						},
					},
					analysis_tasks: true,
				},
			});

			if(!song) {
				return res.respond({
					status: 404,
					message: 'Song not found',
				});
			}

			// 2. (Opcional) Buscar commits en el rango
			const commits = [];
			if(song.repository_id && song.time_range) {
				const { start, end } = song.time_range;
				if(start && end) {
					const foundCommits = await primate.prisma.commit.findMany({
						where: {
							repository_id: song.repository_id,
							author_date: {
								gte: new Date(start),
								lte: new Date(end),
							},
						},
						orderBy: { author_date: 'asc' },
					});
					commits.push(...foundCommits);
				}
			}

			// 3. Armar respuesta
			return res.respond({
				data: {
					...song,
					commitsInRange: commits,
				},
				message: 'Song detailed info retrieved successfully',
			});

		} catch(error) {
			console.error('❌ getSongDetailed error:', error);
			return res.respond({
				status: 500,
				message: `Failed to get song detailed info: ${ error.message }`,
			});
		}
	}

	/**
	 * POST /karaoke/callback/lyrics
	 * Callback específico para cuando se complete la generación de letras (Suno).
	 */
	static async handleSunoCallbackLyrics(req, res) {
		try {
			const callbackData = req.body;

			// Aquí puedes llamar a un método distinto en tu KaraokeService,
			// por ejemplo: KaraokeService.handleSunoLyricsCallback(callbackData).
			// O reutilizar la misma si deseas, pero con un flag que indique “esto es lyrics”.
			const result = await KaraokeService.handleSunoCallbackLyrics(callbackData);

			return res.respond({
				data: result,
				message: 'Lyrics callback processed successfully',
			});
		} catch(error) {
			console.error('❌ handleSunoCallbackLyrics error:', error);
			return res.respond({
				status: 500,
				message: `Failed to process lyrics callback: ${ error.message }`,
			});
		}
	}

}

export default KaraokeController;
