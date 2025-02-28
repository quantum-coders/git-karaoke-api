// github.service.js
import 'dotenv/config';
import axios from 'axios';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class GithubService {
	static API_BASE_URL = 'https://api.github.com';
	static DEFAULT_CACHE_HOURS = 24;

	/**
	 * @function getAuthHeaders
	 * @description Genera las cabeceras de autorización para peticiones a la API de GitHub.
	 * @returns {Object} - Objeto con las cabeceras, incluyendo Authorization si hay token disponible.
	 * @private
	 */
	static #getAuthHeaders() {
		const headers = {
			'Accept': 'application/vnd.github.v3+json',
		};

		if(process.env.GITHUB_API_TOKEN) {
			headers['Authorization'] = `token ${ process.env.GITHUB_API_TOKEN }`;
		}

		return headers;
	}

	/**
	 * @function #generateRequestHash
	 * @description Genera un hash único para cada petición, a fin de usarlo en la cache (ApiCall).
	 * @param {string} method - Método HTTP (GET, POST, etc.).
	 * @param {string} endpoint - Endpoint de la API.
	 * @param {Object} params - Parámetros de la petición.
	 * @returns {string} - Hash único MD5.
	 * @private
	 */
	static #generateRequestHash(method, endpoint, params = {}) {
		return crypto
			.createHash('md5')
			.update(`github:${ method }:${ endpoint }:${ JSON.stringify(params) }`)
			.digest('hex');
	}

	/**
	 * @function #cachedApiCall
	 * @description Realiza una llamada a la API de GitHub con cacheo: si ya existe en base de datos y no ha expirado, usa la respuesta guardada.
	 * @param {string} method - Método HTTP (GET, POST, etc.).
	 * @param {string} endpoint - Endpoint de la API (sin la base URL).
	 * @param {Object} params - Parámetros de la petición.
	 * @param {Object} options - Opciones adicionales.
	 * @param {number} options.cacheHours - Horas que durará la cache antes de expirar.
	 * @param {Object} options.headers - Cabeceras adicionales a enviar en la petición.
	 * @returns {Promise<Object>} - Respuesta de la API en formato JSON.
	 * @private
	 */
	static async #cachedApiCall(method, endpoint, params = {}, options = {}) {
		const {
			cacheHours = this.DEFAULT_CACHE_HOURS,
			headers = {},
		} = options;

		// 1. Generar hash para la petición
		const requestHash = this.#generateRequestHash(method, endpoint, params);

		try {
			// 2. Buscar en ApiCall si ya existe y sigue vigente
			const cachedCall = await prisma.apiCall.findUnique({
				where: { request_hash: requestHash },
			});

			if(
				cachedCall &&
				cachedCall.is_success &&
				(!cachedCall.expires_at || new Date() < new Date(cachedCall.expires_at))
			) {
				console.log(`🔄 [GithubService] Usando respuesta cacheada para ${ method } ${ endpoint }`);
				return cachedCall.response;
			}

			// 3. Preparar la petición real
			const url = `${ this.API_BASE_URL }${ endpoint }`;
			const config = {
				headers: {
					...this.#getAuthHeaders(),
					...headers,
				},
			};

			console.log(`🌐 [GithubService] Llamada a la API: ${ method } ${ url }`);
			const startTime = Date.now();

			// Petición con Axios
			const response = await axios({
				method: method.toLowerCase(),
				url,
				...(method.toUpperCase() === 'GET' ? { params } : { data: params }),
				...config,
			});

			const endTime = Date.now();
			const duration = endTime - startTime;

			// 4. Calcular tiempo de expiración para la cache
			const expiresAt = cacheHours
				? new Date(Date.now() + cacheHours * 60 * 60 * 1000)
				: null;

			// 5. Guardar/actualizar en la tabla ApiCall
			await prisma.apiCall.upsert({
				where: { request_hash: requestHash },
				update: {
					response: response.data,
					status_code: response.status,
					response_time: new Date(endTime),
					duration,
					expires_at: expiresAt,
					is_success: true,
					error_message: null,
					updated_at: new Date(),
				},
				create: {
					service: 'github',
					endpoint,
					method: method.toUpperCase(),
					params: params || {},
					request_hash: requestHash,
					response: response.data,
					status_code: response.status,
					request_time: new Date(startTime),
					response_time: new Date(endTime),
					duration,
					expires_at: expiresAt,
					is_success: true,
					created_at: new Date(),
					updated_at: new Date(),
				},
			});

			// 6. Actualizar contadores en ApiLimit
			await this.#updateApiLimit('github');

			return response.data;
		} catch(error) {
			// Manejo de error, guardar en ApiCall para evitar loops infinitos
			const errorMessage = error.message;
			const statusCode = error.response?.status || 500;

			await prisma.apiCall.upsert({
				where: { request_hash: requestHash },
				update: {
					status_code: statusCode,
					is_success: false,
					error_message: errorMessage,
					response: error.response?.data || null,
					updated_at: new Date(),
				},
				create: {
					service: 'github',
					endpoint,
					method: method.toUpperCase(),
					params: params || {},
					request_hash: requestHash,
					status_code: statusCode,
					is_success: false,
					error_message: errorMessage,
					response: error.response?.data || null,
					request_time: new Date(),
					response_time: new Date(),
					created_at: new Date(),
					updated_at: new Date(),
				},
			});

			console.error(`❌ [GithubService] Error en la llamada a ${ method } ${ endpoint }:`, errorMessage);
			if(error.response?.data) {
				console.error('Response data:', JSON.stringify(error.response.data, null, 2));
			}
			throw error;
		}
	}

	/**
	 * @function #updateApiLimit
	 * @description Actualiza los contadores de límite de peticiones para un servicio dado.
	 * @param {string} service - Nombre del servicio (por ejemplo, 'github').
	 * @private
	 */
	static async #updateApiLimit(service) {
		try {
			await prisma.apiLimit.upsert({
				where: { service },
				update: {
					requests_used: {
						increment: 1,
					},
					updated_at: new Date(),
				},
				create: {
					service,
					requests_limit: service === 'github' ? 5000 : 1000,
					requests_used: 1,
					requests_reset: new Date(Date.now() + 60 * 60 * 1000), // reset en 1 hora
					is_active: true,
					created_at: new Date(),
					updated_at: new Date(),
				},
			});
		} catch(error) {
			console.warn(`⚠️ [GithubService] No se pudo actualizar el límite de API para ${ service }:`, error.message);
		}
	}

	/**
	 * @function getRepoInfo
	 * @description Obtiene la información básica de un repositorio de GitHub.
	 * @param {string} owner - Dueño del repo (usuario u organización).
	 * @param {string} repo - Nombre del repositorio.
	 * @returns {Promise<Object>} - Información del repositorio proveniente de la API.
	 */
	static async getRepoInfo(owner, repo) {
		try {
			const endpoint = `/repos/${ owner }/${ repo }`;
			const data = await this.#cachedApiCall('GET', endpoint);

			// Guardar/actualizar info en la base de datos
			await this.#updateRepositoryRecord(data);

			return data;
		} catch(error) {
			console.error('❌ [GithubService] Error al obtener info del repo:', error.message);
			throw new Error(`Error al obtener la información del repositorio: ${ error.message }`);
		}
	}

	/**
	 * @function #updateRepositoryRecord
	 * @description Crea o actualiza el registro del repositorio en la base de datos.
	 * @param {Object} repoData - Datos del repositorio proveniente de la API de GitHub.
	 * @returns {Promise<Object>} - Registro del repositorio creado o actualizado.
	 * @private
	 */
	static async #updateRepositoryRecord(repoData) {
		try {
			return await prisma.repository.upsert({
				where: { full_name: repoData.full_name },
				update: {
					description: repoData.description || '',
					url: repoData.html_url,
					updated_at: new Date(repoData.updated_at),
					last_fetched_at: new Date(),
					is_private: repoData.private,
					stars: repoData.stargazers_count,
					forks: repoData.forks_count,
					watchers: repoData.watchers_count,
					default_branch: repoData.default_branch,
					language: repoData.language,
					topics: repoData.topics || [],
					meta_data: {
						id: repoData.id,
						node_id: repoData.node_id,
						archived: repoData.archived,
						disabled: repoData.disabled,
						license: repoData.license,
						fork: repoData.fork,
						size: repoData.size,
					},
				},
				create: {
					owner: repoData.owner.login,
					name: repoData.name,
					full_name: repoData.full_name,
					description: repoData.description || '',
					url: repoData.html_url,
					created_at: new Date(repoData.created_at),
					updated_at: new Date(repoData.updated_at),
					last_fetched_at: new Date(),
					is_private: repoData.private,
					stars: repoData.stargazers_count,
					forks: repoData.forks_count,
					watchers: repoData.watchers_count,
					default_branch: repoData.default_branch,
					language: repoData.language,
					topics: repoData.topics || [],
					meta_data: {
						id: repoData.id,
						node_id: repoData.node_id,
						archived: repoData.archived,
						disabled: repoData.disabled,
						license: repoData.license,
						fork: repoData.fork,
						size: repoData.size,
					},
				},
			});
		} catch(error) {
			console.error('❌ [GithubService] Error al actualizar registro del repo:', error.message);
			return null; // Continuar ejecución aunque la DB falle
		}
	}

	/**
	 * @function getCommits
	 * @description Obtiene los commits de un repositorio en base a ciertas opciones (fechas, autor, etc.).
	 * @param {string} owner - Dueño del repo.
	 * @param {string} repo - Nombre del repositorio.
	 * @param {Object} options - Filtros (since, until, author, path, etc.).
	 * @param {number} [options.perPage=100] - Tamaño de página (máx 100).
	 * @param {number} [options.page=1] - Número de página.
	 * @returns {Promise<Array>} - Array de commits.
	 */
	static async getCommits(owner, repo, options = {}) {
		try {
			const {
				since,
				until,
				path,
				author,
				perPage = 100,
				page = 1,
			} = options;

			// Construir query params
			const params = { per_page: perPage, page };
			if(since) params.since = since;
			if(until) params.until = until;
			if(path) params.path = path;
			if(author) params.author = author;

			const endpoint = `/repos/${ owner }/${ repo }/commits`;
			return await this.#cachedApiCall('GET', endpoint, params);
		} catch(error) {
			console.error('❌ [GithubService] Error al obtener commits:', error.message);
			throw new Error(`Error al obtener commits: ${ error.message }`);
		}
	}

	/**
	 * @function getCommitDetails
	 * @description Obtiene la información detallada de un commit (stats, archivos cambiados, etc.).
	 * @param {string} owner - Dueño del repo.
	 * @param {string} repo - Nombre del repositorio.
	 * @param {string} commitSha - SHA del commit.
	 * @returns {Promise<Object>} - Detalle del commit proveniente de la API.
	 */
	static async getCommitDetails(owner, repo, commitSha) {
		try {
			const endpoint = `/repos/${ owner }/${ repo }/commits/${ commitSha }`;
			const data = await this.#cachedApiCall('GET', endpoint);

			// Guardar info en DB
			await this.#storeCommitDetails(owner, repo, data);

			return data;
		} catch(error) {
			console.error('❌ [GithubService] Error al obtener detalles del commit:', error.message);
			throw new Error(`Error al obtener detalles del commit: ${ error.message }`);
		}
	}

	/**
	 * @function #storeCommitDetails
	 * @description Guarda los detalles de un commit en la base de datos (incluyendo archivos).
	 * @param {string} owner - Dueño del repo.
	 * @param {string} repo - Nombre del repositorio.
	 * @param {Object} commitData - Datos del commit provenientes de la API de GitHub.
	 * @returns {Promise<Object|null>} - Registro del commit guardado en la base de datos.
	 * @private
	 */
	static async #storeCommitDetails(owner, repo, commitData) {
		try {
			// Encontrar el repositorio en DB
			const repository = await prisma.repository.findUnique({
				where: { full_name: `${ owner }/${ repo }` },
				select: { id: true },
			});

			if(!repository) {
				console.warn(`⚠️ [GithubService] Repositorio ${ owner }/${ repo } no encontrado en DB`);
				return null;
			}

			// Tomar solo la primera línea del mensaje como "short_message"
			const shortMessage = commitData.commit.message
				.split('\n')[0]
				.substring(0, 255);

			// Upsert para guardar/actualizar commit
			const commit = await prisma.commit.upsert({
				where: {
					repository_id_sha: {
						repository_id: repository.id,
						sha: commitData.sha,
					},
				},
				update: {
					message: commitData.commit.message,
					short_message: shortMessage,
					author_name: commitData.commit.author.name,
					author_email: commitData.commit.author.email,
					author_date: new Date(commitData.commit.author.date),
					committer_name: commitData.commit.committer?.name,
					committer_email: commitData.commit.committer?.email,
					committer_date: commitData.commit.committer?.date
						? new Date(commitData.commit.committer.date)
						: null,
					additions: commitData.stats?.additions || 0,
					deletions: commitData.stats?.deletions || 0,
					changed_files: commitData.stats?.total || 0,
					updated_at: new Date(),
				},
				create: {
					repository_id: repository.id,
					sha: commitData.sha,
					message: commitData.commit.message,
					short_message: shortMessage,
					url: commitData.html_url,
					author_name: commitData.commit.author.name,
					author_email: commitData.commit.author.email,
					author_date: new Date(commitData.commit.author.date),
					committer_name: commitData.commit.committer?.name,
					committer_email: commitData.commit.committer?.email,
					committer_date: commitData.commit.committer?.date
						? new Date(commitData.commit.committer.date)
						: null,
					additions: commitData.stats?.additions || 0,
					deletions: commitData.stats?.deletions || 0,
					changed_files: commitData.stats?.total || 0,
					created_at: new Date(),
					updated_at: new Date(),
				},
			});

			// Si existen archivos en la respuesta, los guardamos
			if(commitData.files && Array.isArray(commitData.files)) {
				// Eliminar archivos anteriores para evitar duplicados
				await prisma.commitFile.deleteMany({
					where: { commit_id: commit.id },
				});

				// Crear los nuevos registros
				const fileRecords = commitData.files.map((file) => ({
					commit_id: commit.id,
					filename: file.filename,
					status: file.status,
					additions: file.additions || 0,
					deletions: file.deletions || 0,
					changes: file.changes || 0,
					patch: file.patch || null,
					created_at: new Date(),
					updated_at: new Date(),
				}));

				await prisma.commitFile.createMany({ data: fileRecords });
			}

			return commit;
		} catch(error) {
			console.error('❌ [GithubService] Error guardando detalles del commit:', error.message);
			return null;
		}
	}

	/**
	 * @function getAllCommitsInDateRange
	 * @description Obtiene todos los commits en un rango de fechas (paginado automático hasta agotar resultados).
	 * @param {string} owner - Dueño del repo.
	 * @param {string} repo - Nombre del repositorio.
	 * @param {Object} options - Filtros (since, until, etc.).
	 * @returns {Promise<Array>} - Array con todos los commits.
	 */
	static async getAllCommitsInDateRange(owner, repo, options = {}) {
		try {
			// Generar un hash especial para identificar esta búsqueda
			const requestHash = this.#generateRequestHash(
				'GET',
				`/repos/${ owner }/${ repo }/all-commits-in-range`,
				options,
			);

			// Revisar si ya está cacheado en ApiCall
			const cachedResult = await prisma.apiCall.findUnique({
				where: { request_hash: requestHash },
			});

			if(
				cachedResult &&
				cachedResult.is_success &&
				(!cachedResult.expires_at || new Date() < new Date(cachedResult.expires_at))
			) {
				console.log('🔄 [GithubService] Usando resultado cacheado para commits en rango');
				return cachedResult.response;
			}

			// No cacheado: iterar sobre todas las páginas
			const allCommits = [];
			let page = 1;
			let hasMoreCommits = true;

			while(hasMoreCommits) {
				const pageOptions = { ...options, page, perPage: 100 };
				const commits = await this.getCommits(owner, repo, pageOptions);

				if(commits.length === 0) {
					hasMoreCommits = false;
				} else {
					allCommits.push(...commits);
					page++;
				}
			}

			// Guardar en cache la lista completa
			await prisma.apiCall.upsert({
				where: { request_hash: requestHash },
				update: {
					response: allCommits,
					status_code: 200,
					response_time: new Date(),
					is_success: true,
					expires_at: new Date(Date.now() + this.DEFAULT_CACHE_HOURS * 60 * 60 * 1000),
					updated_at: new Date(),
				},
				create: {
					service: 'github',
					endpoint: `/repos/${ owner }/${ repo }/all-commits-in-range`,
					method: 'GET',
					params: options,
					request_hash: requestHash,
					response: allCommits,
					status_code: 200,
					request_time: new Date(),
					response_time: new Date(),
					is_success: true,
					expires_at: new Date(Date.now() + this.DEFAULT_CACHE_HOURS * 60 * 60 * 1000),
					created_at: new Date(),
					updated_at: new Date(),
				},
			});

			return allCommits;
		} catch(error) {
			console.error('❌ [GithubService] Error al obtener todos los commits en rango:', error.message);
			throw new Error(`Error obteniendo todos los commits en rango: ${ error.message }`);
		}
	}

	/**
	 * @function getCommitDiff
	 * @description Obtiene el diff completo de un commit en texto plano (formato patch).
	 * @param {string} owner - Dueño del repo.
	 * @param {string} repo - Nombre del repositorio.
	 * @param {string} commitSha - SHA del commit.
	 * @returns {Promise<string>} - String con el diff del commit.
	 */
	static async getCommitDiff(owner, repo, commitSha) {
		try {
			const endpoint = `/repos/${ owner }/${ repo }/commits/${ commitSha }`;
			const options = {
				headers: { 'Accept': 'application/vnd.github.v3.diff' },
				cacheHours: 168, // Cache de 7 días para los diffs
			};

			const diff = await this.#cachedApiCall('GET', endpoint, {}, options);

			// Guardar el diff en la DB
			try {
				const repository = await prisma.repository.findUnique({
					where: { full_name: `${ owner }/${ repo }` },
					select: { id: true },
				});

				if(repository) {
					await prisma.commit.updateMany({
						where: {
							repository_id: repository.id,
							sha: commitSha,
						},
						data: {
							diff: diff.toString(),
							updated_at: new Date(),
						},
					});
				}
			} catch(dbError) {
				console.warn(`⚠️ [GithubService] No se pudo guardar el diff del commit ${ commitSha }:`, dbError.message);
			}

			return diff;
		} catch(error) {
			console.error('❌ [GithubService] Error al obtener diff del commit:', error.message);
			throw new Error(`Error al obtener diff del commit: ${ error.message }`);
		}
	}

	/**
	 * @function getFileContent
	 * @description Obtiene el contenido de un archivo específico en el repo (en base64, se decodifica a UTF-8).
	 * @param {string} owner - Dueño del repo.
	 * @param {string} repo - Nombre del repositorio.
	 * @param {string} path - Ruta del archivo.
	 * @param {string} [ref] - Nombre de la rama/commit/tag.
	 * @returns {Promise<Object>} - Objeto con la metadata y el contenido decodificado.
	 */
	static async getFileContent(owner, repo, path, ref) {
		try {
			const endpoint = `/repos/${ owner }/${ repo }/contents/${ path }`;
			const params = ref ? { ref } : {};

			const data = await this.#cachedApiCall('GET', endpoint, params);

			// GitHub retorna el contenido base64
			const content = Buffer.from(data.content, 'base64').toString('utf8');

			return {
				...data,
				decodedContent: content,
			};
		} catch(error) {
			console.error('❌ [GithubService] Error al obtener contenido del archivo:', error.message);
			throw new Error(`Error al obtener contenido del archivo: ${ error.message }`);
		}
	}

	/**
	 * @function getCommitsForToday
	 * @description Obtiene todos los commits de hoy (desde medianoche hasta ahora).
	 * @param {string} owner - Dueño del repo.
	 * @param {string} repo - Nombre del repositorio.
	 * @param {Object} options - Filtros adicionales (author, path, etc.).
	 * @returns {Promise<Array>} - Array de commits de hoy.
	 */
	static async getCommitsForToday(owner, repo, options = {}) {
		try {
			const today = new Date();
			today.setHours(0, 0, 0, 0);

			const since = today.toISOString();
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);
			const until = tomorrow.toISOString();

			return this.getAllCommitsInDateRange(owner, repo, {
				...options,
				since,
				until,
			});
		} catch(error) {
			console.error('❌ [GithubService] Error al obtener commits de hoy:', error.message);
			throw new Error(`Error al obtener commits de hoy: ${ error.message }`);
		}
	}

	/**
	 * @function getCommitsForThisWeek
	 * @description Obtiene todos los commits de la última semana (7 días atrás hasta hoy).
	 * @param {string} owner - Dueño del repo.
	 * @param {string} repo - Nombre del repositorio.
	 * @param {Object} options - Filtros adicionales (author, path, etc.).
	 * @returns {Promise<Array>} - Array de commits de la semana.
	 */
	static async getCommitsForThisWeek(owner, repo, options = {}) {
		try {
			const today = new Date();
			const weekAgo = new Date(today);
			weekAgo.setDate(weekAgo.getDate() - 7);

			const since = weekAgo.toISOString();
			const until = today.toISOString();

			return this.getAllCommitsInDateRange(owner, repo, {
				...options,
				since,
				until,
			});
		} catch(error) {
			console.error('❌ [GithubService] Error al obtener commits de la semana:', error.message);
			throw new Error(`Error al obtener commits de la semana: ${ error.message }`);
		}
	}

	/**
	 * @function getCommitsInCustomInterval
	 * @description Obtiene los commits en un intervalo de fechas personalizado.
	 * @param {string} owner - Dueño del repo.
	 * @param {string} repo - Nombre del repositorio.
	 * @param {Date} startDate - Fecha inicial.
	 * @param {Date} endDate - Fecha final.
	 * @param {Object} options - Filtros adicionales.
	 * @returns {Promise<Array>} - Array de commits en el intervalo.
	 */
	static async getCommitsInCustomInterval(owner, repo, startDate, endDate, options = {}) {
		try {
			const since = startDate.toISOString();
			const until = endDate.toISOString();

			return this.getAllCommitsInDateRange(owner, repo, {
				...options,
				since,
				until,
			});
		} catch(error) {
			console.error('❌ [GithubService] Error al obtener commits en intervalo:', error.message);
			throw new Error(`Error al obtener commits en intervalo: ${ error.message }`);
		}
	}

	/**
	 * @function extractRepoInfoFromUrl
	 * @description Extrae el owner y el repo a partir de una URL de GitHub (p.ej. https://github.com/owner/repo).
	 * @param {string} repoUrl - URL del repositorio en GitHub.
	 * @returns {Object} - { owner, repo }.
	 */
	static extractRepoInfoFromUrl(repoUrl) {
		try {
			const url = new URL(repoUrl);

			if(!url.hostname.includes('github.com')) {
				throw new Error('URL no válida de GitHub');
			}

			// Quitar slashes del inicio y fin
			const path = url.pathname.replace(/^\/|\/$/g, '');
			const pathSegments = path.split('/');

			if(pathSegments.length < 2) {
				throw new Error('La URL no contiene owner y repo');
			}

			return {
				owner: pathSegments[0],
				repo: pathSegments[1],
			};
		} catch(error) {
			console.error('❌ [GithubService] Error extrayendo info del repo desde URL:', error.message);
			throw new Error(`Error extrayendo info del repositorio: ${ error.message }`);
		}
	}

	/**
	 * @function formatCommitsForAnalysis
	 * @description Formatea la data de commits para análisis/embedding. Crea una AnalysisTask de tipo "commit_analysis".
	 * @param {string} owner - Dueño del repo.
	 * @param {string} repo - Nombre del repositorio.
	 * @param {Array} commits - Array de commits proveniente de la API de GitHub.
	 * @returns {Promise<Array>} - Commits formateados (con detalles y diffs).
	 */
	static async formatCommitsForAnalysis(owner, repo, commits) {
		let analysisTask = null; // Para controlar si se creó la tarea
		try {
			// 1. Ubicar el repositorio en DB
			const repositoryRecord = await prisma.repository.findUnique({
				where: { full_name: `${ owner }/${ repo }` },
			});

			// 2. Crear una AnalysisTask si existe el repo en DB
			if(repositoryRecord) {
				analysisTask = await prisma.analysisTask.create({
					data: {
						repository_id: repositoryRecord.id,
						task_type: 'commit_analysis',
						status: 'processing',
						start_date: new Date(),
						params: {
							commitCount: commits.length,
							firstCommitSha: commits[0]?.sha,
							lastCommitSha: commits[commits.length - 1]?.sha,
						},
						created_at: new Date(),
						updated_at: new Date(),
					},
				});
			}

			const formattedCommits = [];

			// 3. Iterar commits y verificar si ya tenemos info completa en DB
			for(const commit of commits) {
				let existingCommit = null;

				if(repositoryRecord) {
					existingCommit = await prisma.commit.findUnique({
						where: {
							repository_id_sha: {
								repository_id: repositoryRecord.id,
								sha: commit.sha,
							},
						},
						include: { files: true },
					});
				}

				// 4. Si ya tenemos el commit (con files y diff), lo reutilizamos
				if(existingCommit && existingCommit.files.length > 0 && existingCommit.diff) {
					console.log(`🔄 [GithubService] Usando commit cacheado en DB: ${ commit.sha }`);

					formattedCommits.push({
						sha: existingCommit.sha,
						author: {
							name: existingCommit.author_name,
							email: existingCommit.author_email,
							date: existingCommit.author_date.toISOString(),
						},
						committer: existingCommit.committer_name
							? {
								name: existingCommit.committer_name,
								email: existingCommit.committer_email,
								date: existingCommit.committer_date?.toISOString(),
							}
							: null,
						message: existingCommit.message,
						date: existingCommit.author_date.toISOString(),
						files: existingCommit.files.map((file) => ({
							filename: file.filename,
							status: file.status,
							additions: file.additions,
							deletions: file.deletions,
							changes: file.changes,
							patch: file.patch,
						})),
						stats: {
							additions: existingCommit.additions,
							deletions: existingCommit.deletions,
							total: existingCommit.changed_files,
						},
						diff: existingCommit.diff,
					});
					continue;
				}

				// 5. Si no, hacemos una nueva llamada a getCommitDetails y getCommitDiff
				const details = await this.getCommitDetails(owner, repo, commit.sha);

				let diff;
				try {
					diff = await this.getCommitDiff(owner, repo, commit.sha);
				} catch(err) {
					console.warn(`⚠️ [GithubService] No se pudo obtener diff para ${ commit.sha }: ${ err.message }`);
					diff = null;
				}

				formattedCommits.push({
					sha: commit.sha,
					author: details.commit.author,
					committer: details.commit.committer,
					message: details.commit.message,
					date: details.commit.author.date,
					files: details.files.map((file) => ({
						filename: file.filename,
						status: file.status, // added, modified, removed
						additions: file.additions,
						deletions: file.deletions,
						changes: file.changes,
						patch: file.patch,
					})),
					stats: {
						additions: details.stats.additions,
						deletions: details.stats.deletions,
						total: details.stats.total,
					},
					diff: diff,
				});
			}

			// 6. Finalizar la AnalysisTask si existe
			if(analysisTask) {
				await prisma.analysisTask.update({
					where: { id: analysisTask.id },
					data: {
						status: 'completed',
						end_date: new Date(),
						results: {
							commitCount: formattedCommits.length,
							totalAdditions: formattedCommits.reduce((sum, c) => sum + c.stats.additions, 0),
							totalDeletions: formattedCommits.reduce((sum, c) => sum + c.stats.deletions, 0),
							totalChanges: formattedCommits.reduce((sum, c) => sum + c.stats.total, 0),
						},
						updated_at: new Date(),
					},
				});
			}

			return formattedCommits;
		} catch(error) {
			// Si ocurre error, actualizar AnalysisTask a 'failed'
			if(analysisTask) {
				await prisma.analysisTask.update({
					where: { id: analysisTask.id },
					data: {
						status: 'failed',
						end_date: new Date(),
						error: error.message,
						updated_at: new Date(),
					},
				});
			}

			console.error('❌ [GithubService] Error al formatear commits para análisis:', error.message);
			throw new Error(`Error al formatear commits para análisis: ${ error.message }`);
		}
	}

	// github.service.js

	// github.service.js

	static async getCommitsByLastActivity(owner, repo) {
		try {
			// 1) Ver si tenemos repositorio en DB
			const repository = await prisma.repository.findUnique({
				where: { full_name: `${ owner }/${ repo }` },
				select: { id: true },
			});

			// 2) Si el repo no existe, no pasa nada, seguimos.
			//    (Opcional: podrías crearlo vacío; depende de tu lógica)
			if(!repository) {
				console.warn(`[GithubService] No repository in DB for ${ owner }/${ repo }. Creating partial record if needed...`);
				// ...podrías, por ejemplo, crear la entrada en la DB,
				// o simplemente continuar sin DB
			}

			// 3) Buscamos en DB el último commit guardado
			const lastCommit = repository
				? await prisma.commit.findFirst({
					where: { repository_id: repository.id },
					orderBy: { author_date: 'desc' },
				})
				: null;

			// 4) Si ya hay un “último commit” en la DB
			if(lastCommit) {
				// Restamos 3 días si quieres incluir un “buffer”
				const sinceDate = new Date(lastCommit.author_date);
				sinceDate.setDate(sinceDate.getDate() - 3);

				const untilDate = new Date();
				console.log(
					`[GithubService] lastActivity: from ${ sinceDate.toISOString() } to ${ untilDate.toISOString() }`,
				);

				return this.getAllCommitsInDateRange(owner, repo, {
					since: sinceDate.toISOString(),
					until: untilDate.toISOString(),
				});
			}

			// 5) Si NO hay commits en DB,
			//    obtenemos de GitHub el “commit más reciente” (HEAD)
			console.log(`[GithubService] No commits in DB. Fetching HEAD commit from GitHub...`);

			const newestCommits = await this.getCommits(owner, repo, {
				perPage: 1,
				page: 1,
			});
			// “getCommits” suele traer ordenado por fecha DESC,
			// así que newestCommits[0] sería el último commit en HEAD

			if(!newestCommits || newestCommits.length === 0) {
				// Repo vacío o privado sin acceso, etc.
				console.warn('[GithubService] Repo has no commits at all (empty?) Returning [].');
				return [];
			}

			// 6) Tenemos un commit HEAD. Tomamos su fecha
			const headCommit = newestCommits[0];
			const headDateString = headCommit.commit?.author?.date
				|| headCommit.committer?.date
				|| null;

			if(!headDateString) {
				console.warn('[GithubService] Could not parse date from the HEAD commit. Returning that single commit.');
				return newestCommits; // O un array vacío, depende de ti
			}

			// 7) Convertir fecha y restarle 3 días si quieres buffer
			const headDate = new Date(headDateString);
			headDate.setDate(headDate.getDate() - 3);
			const untilDate = new Date();

			console.log(
				`[GithubService] HEAD commit date: ${ headDateString }. Now fetching from ${ headDate.toISOString() } to ${ untilDate.toISOString() }`,
			);

			// 8) Finalmente: traer TODOS los commits de ese rango
			return this.getAllCommitsInDateRange(owner, repo, {
				since: headDate.toISOString(),
				until: untilDate.toISOString(),
			});
		} catch(error) {
			console.error('Error in getCommitsByLastActivity:', error);
			throw error;
		}
	}

	// Dentro de GithubService (o donde prefieras)
	static summarizeCommits(owner, repo, commits) {
		const commitCount = commits.length;
		const authorsMap = {};

		commits.forEach(commit => {
			const authorName = commit.author?.name || 'Unknown';
			authorsMap[authorName] = (authorsMap[authorName] || 0) + 1;
		});

		const authors = Object.keys(authorsMap).map(name => ({
			name,
			count: authorsMap[name],
		}));

		// Ejemplo muy sencillo de “mostChangedFiles”
		let mostChangedFiles = [];
		commits.forEach(c => {
			c.files?.forEach(file => {
				const key = file.filename;
				const existing = mostChangedFiles.find(f => f.filename === key);
				if(!existing) {
					mostChangedFiles.push({ filename: key, changes: file.additions + file.deletions });
				} else {
					existing.changes += file.additions + file.deletions;
				}
			});
		});
		mostChangedFiles = mostChangedFiles.sort((a, b) => b.changes - a.changes);

		return {
			repositoryName: `${ owner }/${ repo }`,
			commitCount,
			authors,
			mostChangedFiles,
			timeRange: {
				// Tendrías que inferir el rango real de commits si quieres
				start: commits[0]?.date || new Date().toISOString(),
				end: commits[commits.length - 1]?.date || new Date().toISOString(),
			},
		};
	}

}

export default GithubService;
