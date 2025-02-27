// test-chroma.js
import 'dotenv/config';
import ChromaService from '#services/chroma.service.js'; // Ajusta la ruta de tu import

async function testChroma() {
  console.log('=== Starting Chroma Service Test ===');

  try {
    // 1. Verificamos la salud del servidor
    const isHealthy = await ChromaService.checkServerHealth();
    if (!isHealthy) {
      console.error('❌ Chroma server is not healthy. Aborting test...');
      return;
    }
    console.log('✅ Chroma server is healthy');

    // 2. Nombre de colección de prueba
    const collectionName = 'test_chroma_collection';

    // 3. Crear o recuperar la colección con embeddings de OpenAI
    //    (Por defecto text-embedding-3-small, text-embedding-ada-002, etc.)
    console.log(`🗃️ Creating or getting collection: ${collectionName}`);
    const collection = await ChromaService.createOrGetCollectionUsingEmbeddings(
      collectionName,     // Nombre
      'openai',           // Integration
      'text-embedding-ada-002' // Modelo de embedding (ajusta si lo deseas)
    );
    console.log('✅ Collection ready:', collection.name);

    // 4. Documentos de prueba
    const docs = [
      'Hello from the other side',
      'This is a test of the Chroma embedding system.',
      'Another random sentence about software development',
      'Chroma is a vector database for LLMs'
    ];

    // 5. Generamos embeddings con ChromaService (OpenAI por dentro)
    console.log('💡 Generating embeddings for docs...');
    const embeddings = await ChromaService.generateEmbeddings(docs, 'openai', 'text-embedding-ada-002');
    console.log('✅ Embeddings generated, length:', embeddings.length);

    // 6. IDs y metadatos de ejemplo
    const ids = docs.map((_, i) => `test_doc_${i}`);
    const metadatas = docs.map((text, i) => ({
      index: i,
      source: 'test_script',
      timestamp: Date.now()
    }));

    // 7. Upsert en la colección
    console.log('💾 Upserting documents in the collection...');
    await ChromaService.upsertDocuments(collection, docs, ids, embeddings, metadatas);
    console.log(`✅ Upserted ${docs.length} docs`);

    // 8. Consulta semántica de prueba
    const testQuery = 'software development test';
    console.log(`🔎 Querying the collection with: "${testQuery}"`);
    const queryResult = await ChromaService.queryCollection(
      collection,
      [testQuery],
      2 // top N results
    );

    // 9. Mostramos resultados
    console.log('📝 Query result:');
    console.dir(queryResult, { depth: null });

    // 10. (Opcional) Borrar la colección si quieres limpiar
    // console.log('🗑️ Deleting test collection...');
    // await ChromaService.deleteCollection(collectionName);
    // console.log('✅ Collection deleted');

    console.log('=== Test completed successfully ===');
  } catch (error) {
    console.error('❌ Error in Chroma test:', error.message);
    console.error(error);
  }
}

// Ejecutar test
testChroma();
