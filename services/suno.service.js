import 'dotenv/config';
import axios from 'axios';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import UploadService from '#services/upload.service.js';

const prisma = new PrismaClient();

class SunoService {
  static API_BASE_URL = 'https://apibox.erweima.ai/api';
  static API_VERSION = 'v1';
  static DEFAULT_CACHE_HOURS = 24; // puedes ajustar si lo deseas

  /**
   * @function #getAuthHeaders
   * @description Genera las cabeceras de autorización para Suno API.
   * @returns {Object} - Headers con Authorization (Bearer <SUNO_API_KEY>)
   * @private
   */
  static #getAuthHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUNO_API_KEY}`,
    };
  }

  /**
   * @function #generateRequestHash
   * @description Genera un hash único para identificar la llamada y evitar duplicados en la tabla ApiCall.
   * @param {string} method - Método HTTP (GET, POST, etc.)
   * @param {string} endpoint - Endpoint relativo dentro de la API de Suno
   * @param {Object} queryOrParams - Parámetros de consulta (GET) o body (POST)
   * @returns {string} - Hash MD5 único
   * @private
   */
  static #generateRequestHash(method, endpoint, queryOrParams = {}) {
    return crypto
      .createHash('md5')
      .update(`suno:${method}:${endpoint}:${JSON.stringify(queryOrParams)}`)
      .digest('hex');
  }

  /**
   * @function #updateApiLimit
   * @description Actualiza la tabla ApiLimit para el servicio "suno" incrementando en 1 el contador de peticiones usadas.
   * @private
   */
  static async #updateApiLimit() {
    try {
      await prisma.apiLimit.upsert({
        where: { service: 'suno' },
        update: {
          requests_used: { increment: 1 },
          updated_at: new Date(),
        },
        create: {
          service: 'suno',
          requests_limit: 1000, // Ajusta según tus planes o necesidades
          requests_used: 1,
          requests_reset: new Date(Date.now() + 60 * 60 * 1000), // 1 hora
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
    } catch (error) {
      console.warn(`⚠️ [SunoService] No se pudo actualizar ApiLimit para "suno": ${error.message}`);
    }
  }

  /**
   * @function #cachedApiCall
   * @description Realiza una llamada a la API de Suno con caché, verificando/almacenando en ApiCall.
   * @param {string} method - Método HTTP (GET, POST, etc.)
   * @param {string} endpoint - Endpoint relativo de Suno (ej: "/v1/generate")
   * @param {Object} requestData - Datos o parámetros de la petición
   * @param {Object} [options] - Opciones adicionales
   * @param {number} [options.cacheHours=24] - Horas de cache
   * @param {Object} [options.headers] - Cabeceras adicionales
   * @param {boolean} [options.disableCache=false] - Si es true, ignora la caché y fuerza la llamada
   * @returns {Promise<any>} - Respuesta de la API (JSON parseado)
   * @private
   */
  static async #cachedApiCall(method, endpoint, requestData = {}, options = {}) {
    const {
      cacheHours = this.DEFAULT_CACHE_HOURS,
      headers = {},
      disableCache = false,
    } = options;

    // 1. Construir URL completa y hash
    const url = `${this.API_BASE_URL}${endpoint}`;
    const requestHash = this.#generateRequestHash(method, endpoint, requestData);

    try {
      // -----------------------------
      // SALTAR LÓGICA DE CACHÉ SI ASÍ SE INDICA
      // -----------------------------
      if (!disableCache) {
        // 2. Buscar en DB si ya existe una respuesta cacheada válida
        const cachedCall = await prisma.apiCall.findUnique({
          where: { request_hash: requestHash },
        });

        if (
          cachedCall &&
          cachedCall.is_success &&
          (!cachedCall.expires_at || new Date() < new Date(cachedCall.expires_at))
        ) {
          console.log(`🔄 [SunoService] Usando respuesta cacheada para ${method} ${endpoint}`);
          return cachedCall.response;
        }
      }

      // 3. Preparar la llamada a la API
      console.log(`🌐 [SunoService] Llamando a Suno API -> ${method} ${url}`);

      const axiosConfig = {
        method: method.toLowerCase(),
        url,
        headers: {
          ...this.#getAuthHeaders(),
          ...headers,
        },
      };
      // Dependiendo del método, usamos 'params' (para GET) o 'data' (para POST, etc.)
      if (method.toUpperCase() === 'GET') {
        axiosConfig.params = requestData;
      } else {
        axiosConfig.data = requestData;
      }

      const startTime = Date.now();
      const response = await axios(axiosConfig);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // 4. Calcular expiración de cache
      const expiresAt = cacheHours
        ? new Date(Date.now() + cacheHours * 60 * 60 * 1000)
        : null;

      // 5. Guardar/actualizar en ApiCall
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
          service: 'suno',
          endpoint,
          method: method.toUpperCase(),
          params: requestData,
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

      // 6. Actualizar uso de ApiLimit
      await this.#updateApiLimit();

      return response.data;
    } catch (error) {
      const errorMessage = error.message;
      const statusCode = error.response?.status || 500;

      // Guardar la llamada fallida en ApiCall
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
          service: 'suno',
          endpoint,
          method: method.toUpperCase(),
          params: requestData,
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

      console.error(`❌ [SunoService] Error en la petición ${method} ${endpoint}:`, errorMessage);
      if (error.response?.data) {
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Suno API call failed: ${errorMessage}`);
    }
  }

  // ---------------------------------------------------------
  //       MÉTODOS PÚBLICOS (usando #cachedApiCall)
  // ---------------------------------------------------------

  /**
   * @function generateAudio
   * @description Crea una nueva tarea de generación de audio en Suno.
   * @param {Object} params - Parámetros para la generación de audio
   * @param {string} params.prompt - Prompt de descripción
   * @param {string} [params.style] - Estilo musical (solo si customMode = true)
   * @param {string} [params.title] - Título de la canción (solo si customMode = true)
   * @param {boolean} [params.customMode=true] - Bandera para habilitar modo custom
   * @param {boolean} [params.instrumental=false] - Si se desea solo instrumental
   * @param {string} [params.model='V3_5'] - Modelo (V3_5 o V4)
   * @param {string} params.callBackUrl - URL de callback para notificar el estado final
   * @returns {Promise<Object>}
   */
  static async generateAudio(params) {
    const {
      prompt,
      style,
      title,
      customMode = true,
      instrumental = false,
      model = 'V3_5',
      callBackUrl,
    } = params;

    if (!prompt) throw new Error('Missing parameter: prompt');
    if (!callBackUrl) throw new Error('Missing parameter: callBackUrl');

    // Validaciones del modo custom
    if (customMode) {
      if (instrumental && (!style || !title)) {
        throw new Error('Custom mode + instrumental requiere style y title');
      }
      if (!instrumental && (!style || !prompt || !title)) {
        throw new Error('Custom mode requiere style, prompt y title (si no es instrumental)');
      }
      if (prompt.length > 3000) {
        throw new Error('Prompt excede 3000 caracteres en customMode');
      }
      if (style && style.length > 200) {
        throw new Error('Style excede 200 caracteres');
      }
      if (title && title.length > 80) {
        throw new Error('Title excede 80 caracteres');
      }
    } else {
      // Validación prompt si NO es custom
      if (prompt.length > 400) {
        throw new Error('Prompt excede 400 caracteres en non-custom mode');
      }
    }

    const requestData = {
      prompt,
      customMode,
      instrumental,
      model,
      callBackUrl,
    };

    if (customMode) {
      if (style) requestData.style = style;
      if (title) requestData.title = title;
    }

    const endpoint = `/${this.API_VERSION}/generate`;
    return this.#cachedApiCall('POST', endpoint, requestData);
  }

  /**
   * @function generateLyrics
   * @description Crea una tarea de generación de letras en Suno.
   * @param {Object} params
   * @param {string} params.prompt - Prompt para la generación de letras
   * @param {string} params.callBackUrl - URL callback
   * @returns {Promise<Object>}
   */
  static async generateLyrics(params) {
    const { prompt, callBackUrl } = params;
    if (!prompt) throw new Error('Missing parameter: prompt');
    if (!callBackUrl) throw new Error('Missing parameter: callBackUrl');

    const endpoint = `/${this.API_VERSION}/lyrics`;
    const requestData = { prompt, callBackUrl };
    return this.#cachedApiCall('POST', endpoint, requestData);
  }

  /**
   * @function getTaskDetails
   * @description Consulta el estado de una tarea de generación de audio (sin caché por defecto en este ejemplo).
   * @param {string} taskId - ID de la tarea
   * @param {Object} [options] - Opciones adicionales (por ejemplo, { disableCache: true })
   * @returns {Promise<Object>}
   */
  static async getTaskDetails(taskId, options = {}) {
    if (!taskId) throw new Error('Missing parameter: taskId');

    const endpoint = `/${this.API_VERSION}/generate/record-info`;

    // Para GET, pasamos query params + disableCache si deseas
    // Por ejemplo, forzamos "disableCache: true" siempre,
    // o lo dejemos opcional según un param en "options"
    const finalOptions = {
      ...options,
      disableCache: true, // <--- Por defecto no usa caché
    };

    return this.#cachedApiCall('GET', endpoint, { taskId }, finalOptions);
  }

  /**
   * @function getLyricsTaskDetails
   * @description Consulta el estado de una tarea de generación de letras (sin caché por defecto).
   * @param {string} taskId - ID de la tarea
   * @param {Object} [options] - Opciones adicionales
   * @returns {Promise<Object>}
   */
  static async getLyricsTaskDetails(taskId, options = {}) {
    if (!taskId) throw new Error('Missing parameter: taskId');

    const endpoint = `/${this.API_VERSION}/lyrics/record-info`;

    // Igual que arriba: forzamos disableCache
    const finalOptions = {
      ...options,
      disableCache: true,
    };

    return this.#cachedApiCall('GET', endpoint, { taskId }, finalOptions);
  }

  /**
   * @function getTimestampedLyrics
   * @description Obtiene la letra con timestamps para sincronización.
   * @param {Object} params
   * @param {string} params.taskId
   * @param {string} [params.audioId]
   * @param {number} [params.musicIndex]
   * @returns {Promise<Object>}
   */
  static async getTimestampedLyrics(params) {
    const { taskId, audioId, musicIndex } = params;
    if (!taskId) throw new Error('Missing parameter: taskId');

    const endpoint = `/${this.API_VERSION}/generate/get-timestamped-lyrics`;
    const requestData = { taskId };
    if (audioId) requestData.audioId = audioId;
    if (musicIndex !== undefined) requestData.musicIndex = musicIndex;

    // Para timestamped lyrics, no siempre hace falta polling,
    // pero si lo quieres sin caché, podrías pasar disableCache aquí también:
    return this.#cachedApiCall('POST', endpoint, requestData, { disableCache: true });
  }

  /**
   * @function getRemainingCredits
   * @description Consulta los créditos restantes de la cuenta actual en Suno. (si quieres caché, lo puedes dejar)
   * @returns {Promise<Object>}
   */
  static async getRemainingCredits() {
    const endpoint = `/${this.API_VERSION}/generate/credit`;
    // GET sin parámetros
    return this.#cachedApiCall('GET', endpoint, {});
  }

  /**
   * @function downloadAndSaveSongFromCallback
   * @description Descarga y guarda el archivo de audio proporcionado en el callback de Suno.
   * @param {Object} callbackData - Datos del callback
   * @returns {Promise<Array>} - Lista de resultados (trackInfo + attachment)
   */
  static async downloadAndSaveSongFromCallback(callbackData) {
    try {
      if (!callbackData?.data?.data || !Array.isArray(callbackData.data.data)) {
        throw new Error('Estructura de callback data inválida');
      }

      const tracks = callbackData.data.data;
      const results = [];

      for (const track of tracks) {
        if (!track.audio_url) {
          console.warn('⚠️ [SunoService] No se encontró audio_url en el track');
          continue;
        }
        // Descargar y guardar con UploadService
        const attachment = await UploadService.createAttachmentFromUrl(track.audio_url, {
          metas: {
            sunoId: track.id,
            sunoTaskId: callbackData.data.task_id,
            sunoTitle: track.title,
            sunoDuration: track.duration,
            sunoPrompt: track.prompt,
            sunoTags: track.tags,
            sunoModelName: track.model_name,
            source: 'suno',
          },
        });

        results.push({ trackInfo: track, attachment });
      }

      return results;
    } catch (error) {
      console.error('❌ [SunoService] Error al descargar canción:', error.message);
      throw new Error(`Error downloading song: ${error.message}`);
    }
  }

  /**
   * @function waitForTaskCompletion
   * @description Hace polling hasta que la tarea se completa o falla.
   * @param {string} taskId - ID de la tarea
   * @param {number} [maxAttempts=60] - Máx intentos
   * @param {number} [interval=5000] - Intervalo en ms
   * @param {string} [taskType='audio'] - Tipo de tarea ('audio' o 'lyrics')
   * @returns {Promise<Object>}
   */
  static async waitForTaskCompletion(taskId, maxAttempts = 60, interval = 5000, taskType = 'audio') {
    let attempts = 0;

    return new Promise((resolve, reject) => {
      const checkStatus = async () => {
        try {
          let taskData;
          if (taskType === 'lyrics') {
            // Llamamos getLyricsTaskDetails con disableCache: true
            taskData = await this.getLyricsTaskDetails(taskId, { disableCache: true });
          } else {
            // Llamamos getTaskDetails con disableCache: true
            taskData = await this.getTaskDetails(taskId, { disableCache: true });
          }

          const status = taskData?.data?.status;
          if (status === 'SUCCESS') {
            resolve(taskData);
            return;
          }
          if (status && status.includes('FAILED')) {
            reject(
              new Error(
                `Task failed with status: ${status}, error: ${taskData?.data?.errorMessage || 'Unknown error'}`
              )
            );
            return;
          }

          attempts++;
          if (attempts >= maxAttempts) {
            reject(new Error(`Task did not complete after ${maxAttempts} attempts`));
            return;
          }
          setTimeout(checkStatus, interval);
        } catch (error) {
          reject(error);
        }
      };

      checkStatus();
    });
  }
}

export default SunoService;
