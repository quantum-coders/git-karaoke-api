import 'dotenv/config';
import axios from 'axios';
import { promptTokensEstimate } from 'openai-chat-tokens';
import { groqModels, openAIModels, openRouterModels, perplexityModels } from '../assets/data/ai-models.js';
import UploadService from '#services/upload.service.js';

class AIService {

	/**
	 * Genera una portada (cover image) usando la API de OpenAI (DALL-E),
	 * la descarga y la sube a DigitalOcean (UploadService).
	 * Retorna el Attachment creado.
	 */
	static async generateCoverImage(prompt, options = {}) {
		const {
			size = '512x512',         // puede ser 256x256, 512x512, 1024x1024 (DALL-E v2)
			model = 'dall-e-2',      // o 'dall-e-3' si tienes acceso
			n = 1,                   // solo 1 imagen
			responseFormat = 'url',  // 'url' o 'b64_json'
		} = options;

		if(!prompt) {
			throw new Error('Prompt de imagen requerido');
		}

		try {
			// 1) Llamada a OpenAI /images/generations
			const endpoint = 'https://api.openai.com/v1/images/generations';
			const headers = {
				'Authorization': `Bearer ${ process.env.OPENAI_API_KEY }`,
				'Content-Type': 'application/json',
			};

			const body = {
				prompt,
				model,
				n,
				size,
				response_format: responseFormat,
			};

			// (Opcional) Podrías guardar esta llamada en ApiCall para caching
			// pero a modo simple, la hacemos directa:
			const startTime = Date.now();
			const response = await axios.post(endpoint, body, { headers });
			const endTime = Date.now();

			// parsear la respuesta
			// Ejemplo: { created: 123456789, data: [{ url: '...'}, ... ]}
			const imageData = response.data?.data;
			if(!imageData || imageData.length === 0) {
				throw new Error('No se recibió URL de imagen de OpenAI');
			}
			const imageUrl = imageData[0].url;
			if(!imageUrl) {
				throw new Error('No se pudo extraer la URL de la imagen generada');
			}

			// 2) Subir a DO: crea un Attachment
			//    Podemos usar la función createAttachmentFromUrl
			const attachment = await UploadService.createAttachmentFromUrl(imageUrl, {
				acl: 'public-read',
				metas: {
					openaiEndpoint: endpoint,
					openaiModel: model,
					openaiSize: size,
					openaiPrompt: prompt,
					openaiResponseTime: endTime - startTime,
				},
			});

			// Retornamos el Attachment con .url, .id, etc.
			return attachment;
		} catch(error) {
			console.error('❌ [AIService] Error generando imagen:', error.message);
			throw new Error('Error generando cover image: ' + error.message);
		}
	}

	static async sendMessage(data) {
		let {
			model,
			system = '',
			prompt,
			stream = false,
			history = [],
			temperature = 0.5,
			max_tokens,
			top_p = 1,
			frequency_penalty = 0.0001,
			presence_penalty = 0,
			stop = '',
			tools = [],
			toolChoice,

			// 👇 Nuevo parámetro para soportar JSON mode o Structured Outputs
			responseFormat = null,
		} = data;

		if(!model) throw new Error('Missing field: model');
		if(!prompt) throw new Error('Missing field: prompt');

		try {
			// 1. Info del modelo
			const modelInfo = this.solveModelInfo(model);
			const provider = modelInfo.provider;
			const contextWindow = modelInfo.contextWindow;
			const authToken = modelInfo.authToken;

			// 2. Ajuste de contenido
			const adjusted = this.adjustContent(system, history, prompt, contextWindow);
			system = adjusted.system;
			history = adjusted.history;
			prompt = adjusted.prompt;

			// 3. Construimos los mensajes
			const messages = [
				{ role: 'system', content: system },
				...history,
				{ role: 'user', content: prompt },
			];

			// 4. Cálculo de max_tokens
			let maxTokensCalc = contextWindow - this.estimateTokens(messages);
			if(typeof max_tokens !== 'number') {
				max_tokens = maxTokensCalc;
			}

			// 5. Cuerpo de la request
			const requestData = {
				model,
				messages,
				temperature,
				top_p,
				frequency_penalty,
				presence_penalty,
				stream,
				max_tokens,
			};

			// 6. Tools / function calling
			if(tools.length > 0 && provider === 'openai') {
				requestData.tools = tools;
				requestData.tool_choice = toolChoice || 'auto';
			}

			if(stop) requestData.stop = stop;

			// 🔥 7. Agregar la opción de response_format si se proporcionó
			//     Solo envíalo si no es null, para no romper en modelos que no lo admitan.
			if(responseFormat) {
				requestData.response_format = responseFormat;
				/// si viene response format max_tokens es 4096
				requestData.max_tokens = 4096;
			}

			// 8. URL del provider
			const url = this.solveProviderUrl(provider);

			// 9. Headers y configuración Axios
			const headers = {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${ authToken }`,
			};
			const axiosConfig = { headers };
			if(stream) {
				axiosConfig.responseType = 'stream';
			}

			// 10. Petición
			const response = await axios.post(url, requestData, axiosConfig);
			return response.data;
		} catch(error) {
			if(error.response?.data) {
				console.error('❌ [AIService] Error Response:', JSON.stringify(error.response.data, null, 2));
			} else {
				console.error('❌ [AIService] Error:', error.message);
			}
			throw new Error('Error processing request: ' + error.message);
		}
	}

	// ------------------------------------------------------------------
	//    Info del modelo
	// ------------------------------------------------------------------
	static solveModelInfo(model) {
		const allModels = [ ...openAIModels, ...perplexityModels, ...groqModels ];
		const modelInfo = allModels.find(m => m.name === model);
		if(!modelInfo) throw new Error(`Model info not found for: ${ model }`);

		let provider = '';
		let authToken = '';

		if(openAIModels.some(m => m.name === model)) {
			provider = 'openai';
			authToken = process.env.OPENAI_API_KEY;
		} else if(perplexityModels.some(m => m.name === model)) {
			provider = 'perplexity';
			authToken = process.env.PERPLEXITY_API_KEY;
		} else if(groqModels.some(m => m.name === model)) {
			provider = 'groq';
			authToken = process.env.GROQ_API_KEY;
		} else if(openRouterModels.some(m => m.name === model)) {
			provider = 'openrouter';
			authToken = process.env.OPEN_ROUTER_KEY;
		} else {
			throw new Error(`Provider not found for model: ${ model }`);
		}

		if(!authToken) throw new Error(`Auth token not found for provider: ${ provider }`);

		const contextWindow = modelInfo.contextWindow || 4096;
		return { ...modelInfo, provider, authToken, contextWindow };
	}

	// ------------------------------------------------------------------
	//    URL base según provider
	// ------------------------------------------------------------------
	static solveProviderUrl(provider) {
		if(provider === 'openai') {
			return 'https://api.openai.com/v1/chat/completions';
		} else if(provider === 'perplexity') {
			return 'https://api.perplexity.ai/chat/completions';
		} else if(provider === 'groq') {
			return 'https://api.groq.com/openai/v1/chat/completions';
		} else if(provider === 'openrouter') {
			return 'https://openrouter.ai/api/v1/chat/completions';
		}
		throw new Error(`Provider not supported: ${ provider }`);
	}

	// ------------------------------------------------------------------
	//    Ajuste de prompts largos
	// ------------------------------------------------------------------
	static adjustContent(system, history, prompt, contextWindow) {
		const targetTokens = contextWindow;
		let currentTokens = this.estimateTokens([
			{ role: 'system', content: system },
			...history,
			{ role: 'user', content: prompt },
		]);

		let iteration = 0;
		const maxIterations = 100;

		while(currentTokens > targetTokens) {
			iteration++;
			if(iteration > maxIterations) break;

			const tokensOver = currentTokens - targetTokens;
			const chunkSize = Math.ceil(tokensOver * 0.5);
			const approxCharsPerToken = 4;
			const charsToRemove = chunkSize * approxCharsPerToken;

			// recortamos en orden: history -> system -> prompt
			if(history.length > 1) {
				history.shift();
			} else if(system.length > 50) {
				const trimLength = Math.min(charsToRemove, system.length - 50);
				system = system.slice(0, -trimLength);
			} else if(prompt.length > 50) {
				const trimLength = Math.min(charsToRemove, prompt.length - 50);
				prompt = prompt.slice(0, -trimLength);
			} else {
				break;
			}
			currentTokens = this.estimateTokens([
				{ role: 'system', content: system },
				...history,
				{ role: 'user', content: prompt },
			]);
		}
		return { system, history, prompt };
	}

	// ------------------------------------------------------------------
	//    Estimar tokens
	// ------------------------------------------------------------------
	static estimateTokens(messages) {
		return promptTokensEstimate({ messages });
	}
}

export default AIService;
