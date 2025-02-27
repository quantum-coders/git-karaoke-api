import 'dotenv/config';
import {ChromaClient, OpenAIEmbeddingFunction} from 'chromadb';

class ChromaService {
	static BASE_URL = process.env.CHROMA_SERVER_URL;

	/**
	 * NOTA IMPORTANTE:
	 * - Eliminamos `auth: { provider: 'basic', ... }`
	 * - Inyectamos cabecera de Authorization vía `fetchOptions`
	 */
	static client = new ChromaClient({
		path: ChromaService.BASE_URL,
		fetchOptions: {
			headers: {
				'Authorization': `Basic ${Buffer
					.from(process.env.CHROMA_SERVER_CREDENTIALS || '')
					.toString('base64')}`,
				'Content-Type': 'application/json',
			},
		},
	});

	/**
	 * Creates a new collection.
	 * @param {string} name - The name of the collection.
	 * @param {object} metadata - Metadata for the collection.
	 * @returns {Promise<object>} - The created collection.
	 */
	static async createCollection(name, metadata = {}) {
		// Construimos el payload sin metadata si está vacío
		const payload = {name};

		if (metadata && Object.keys(metadata).length > 0) {
			payload.metadata = metadata;
		}

		return await this.client.createCollection(payload);
	}

	/**
	 * Gets an existing collection.
	 * @param {string} name - The name of the collection.
	 * @returns {Promise<object>} - The retrieved collection.
	 */
	static async getCollection(name) {
		return await this.client.getCollection({name});
	}

	/**
	 * Gets or creates a collection.
	 * @param {string} name - The name of the collection.
	 * @param {object} metadata - Metadata for the collection.
	 * @returns {Promise<object>} - The got or created collection.
	 */
	static async getOrCreateCollection(name, metadata = {}) {
		// Construimos el payload sin metadata si está vacío
		const payload = {name};

		if (metadata && Object.keys(metadata).length > 0) {
			payload.metadata = metadata;
		}

		return await this.client.getOrCreateCollection(payload);
	}

	/**
	 * Deletes a collection by name.
	 * @param {string} name - The name of the collection.
	 * @returns {Promise<void>}
	 */
	static async deleteCollection(name) {
		return await this.client.deleteCollection({name});
	}

	/**
	 * Lists all collections.
	 * ⚠️ Desde v0.6.0, devuelve sólo un array de strings con los nombres de colección.
	 * @returns {Promise<string[]>} - The list of collection names.
	 */
	static async listCollections() {
		return await this.client.listCollections();
	}

	/**
	 * Adds documents to a collection, optionally with associated embeddings and metadata.
	 */
	static async addDocuments(collection, documents, ids, embeddings = [], metadatas = []) {
		if (
			documents.length !== ids.length ||
			(embeddings.length > 0 && documents.length !== embeddings.length)
		) {
			throw new Error(
				'Mismatched input lengths: documents, ids, and embeddings (if provided) must have the same length.',
			);
		}
		if (metadatas.length === 0) {
			metadatas = Array(documents.length).fill({});
		}

		const documentPayload = {
			ids,
			documents,
			metadatas,
		};

		if (embeddings.length > 0) {
			documentPayload.embeddings = embeddings;
		}

		return await collection.add(documentPayload);
	}

	/**
	 * Upserts documents to a collection with associated metadata and embeddings.
	 */
	static async upsertDocuments(
		collection,
		documents,
		ids,
		embeddings = [],
		metadatas = [],
	) {
		if (
			documents.length !== ids.length ||
			(embeddings.length > 0 && documents.length !== embeddings.length)
		) {
			throw new Error(
				'Mismatched input lengths: documents, ids, and embeddings (if provided) must have the same length.',
			);
		}
		if (metadatas.length === 0) {
			metadatas = Array(documents.length).fill({});
		}

		const documentPayload = {
			ids,
			documents,
			metadatas,
		};

		if (embeddings.length > 0) {
			documentPayload.embeddings = embeddings;
		}

		return await collection.upsert(documentPayload);
	}

	/**
	 * Queries a collection.
	 */
	static async queryCollection(
		collection,
		queryTexts,
		nResults = 10,
		where = {},
		include = ['documents', 'metadatas', 'distances'],
	) {
		const payload = {queryTexts, nResults, include};
		if (where && Object.keys(where).length > 0) {
			payload.where = where;
		}
		return await collection.query(payload);
	}

	/**
	 * Deletes documents from a collection.
	 */
	static async deleteDocuments(collection, ids = [], where = {}) {
		const payload = {};
		if (ids && ids.length > 0) {
			payload.ids = ids;
		}
		if (where && Object.keys(where).length > 0) {
			payload.where = where;
		}
		return await collection.delete(payload);
	}

	/**
	 * Gets documents from a collection.
	 */
	static async getDocuments(
		collection,
		ids = [],
		where = {},
		include = ['documents', 'metadatas'],
	) {
		const payload = {include};
		if (ids && ids.length > 0) {
			payload.ids = ids;
		}
		if (where && Object.keys(where).length > 0) {
			payload.where = where;
		}
		return await collection.get(payload);
	}

	/**
	 * Peeks into a collection to see a limited number of items.
	 */
	static async peekCollection(collection, limit = 10) {
		return await collection.peek({limit});
	}

	/**
	 * Counts the number of items in a collection.
	 */
	static async countItems(collection) {
		return await collection.count();
	}

	/**
	 * Modifies a collection's metadata or name.
	 */
	static async modifyCollection(collection, newName = null, newMetadata = {}) {
		return await collection.modify({
			name: newName,
			metadata: newMetadata,
		});
	}

	/**
	 * Generates embeddings for a list of text documents using a specified embedding model.
	 */
	static async generateEmbeddings(
		texts,
		integration = 'openai',
		model = 'text-embedding-3-small',
	) {
		console.log('=== generateEmbeddings Debug Logs ===');
		// console.log('Input texts:', texts);
		console.log('Integration:', integration);
		console.log('Model:', model);

		if (!Array.isArray(texts)) {
			throw new Error('texts must be an array');
		}

		const validTexts = texts
			.filter(text => text != null)
			.map(text => String(text).trim())
			.filter(text => text.length > 0);

		if (validTexts.length === 0) {
			throw new Error('No valid texts provided for embedding generation');
		}

		switch (integration) {
			case 'openai':
				console.log('Creating OpenAI embedding function...');
				const embeddingFunction = new OpenAIEmbeddingFunction({
					openai_api_key: process.env.OPENAI_API_KEY,
					openai_model: model,
				});

				try {
					console.log('Attempting to generate embeddings...');
					const embeddings = await embeddingFunction.generate(validTexts);
					console.log('Embeddings generated successfully');
					return embeddings;
				} catch (error) {
					console.error('====== OpenAI Embedding Error ======');
					console.error('Error message:', error.message);
					console.error('Full error:', error);
					throw new Error('Failed to generate embeddings using OpenAI: ' + error.message);
				}

			default:
				throw new Error(`Unsupported embedding integration: ${integration}`);
		}
	}

	/**
	 * Crea o recupera una colección Chroma con una función de embedding (por defecto "openai").
	 */
	static async createOrGetCollectionUsingEmbeddings(
		collectionName,
		integration = 'openai',
		model = 'text-embedding-3-small',
	) {
		const isHealthy = await this.checkServerHealth();
		if (!isHealthy) {
			throw new Error(
				'Chroma server is not responding correctly. Please check the server status and credentials.',
			);
		}

		let embeddingFunction;
		switch (integration.toLowerCase()) {
			case 'openai':
				embeddingFunction = new OpenAIEmbeddingFunction({
					openai_api_key: process.env.OPENAI_API_KEY,
					openai_model: model,
				});
				break;
			default:
				throw new Error(`Unsupported embedding integration: ${integration}`);
		}

		try {
			// Omitimos metadata si está vacío (por si tu server también exige no enviar metadata vacío)
			return await this.client.getOrCreateCollection({
				name: collectionName,
				embeddingFunction,
			});
		} catch (error) {
			if (error.code === 'already_exists') {
				return await this.client.getCollection({name: collectionName});
			} else {
				throw new Error(`Error creating/getting collection: ${error.message}`);
			}
		}
	}

	/**
	 * Verifica la salud del servidor Chroma.
	 */
	static async checkServerHealth() {
		console.log('=== Chroma Server Health Check ===');
		console.log('Server URL:', ChromaService.BASE_URL);
		console.log('Credentials present:', !!process.env.CHROMA_SERVER_CREDENTIALS);

		if (!process.env.CHROMA_SERVER_CREDENTIALS) {
			console.error('❌ CHROMA_SERVER_CREDENTIALS no está configurado en las variables de entorno');
			return false;
		}

		try {
			const credentials = Buffer
				.from(process.env.CHROMA_SERVER_CREDENTIALS)
				.toString('base64');

			console.log('Attempting connection to API v2...');
			const response = await fetch(`${ChromaService.BASE_URL}/api/v2`, {
				headers: {
					'Authorization': `Basic ${credentials}`,
					'Content-Type': 'application/json',
				},
			});

			const text = await response.text();
			console.log('HTTP Status:', response.status);
			console.log('HTTP Response:', text);

			if (response.ok) {
				console.log('✅ API v1 connection successful');
				return true;
			} else {
				console.error('❌ API connection failed with status:', response.status);
				return false;
			}
		} catch (error) {
			console.error('❌ Server check failed');
			console.error('Error type:', error.name);
			console.error('Error message:', error.message);

			// Verificar conectividad general
			try {
				await fetch('https://google.com');
				console.log('✅ Internet connection is working');
				console.error('❌ Problem is specific to Chroma server');
			} catch (netError) {
				console.error('❌ General network connectivity issues detected');
			}

			return false;
		}
	}
}

export default ChromaService;
