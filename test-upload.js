import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import UploadService from './services/upload.service.js'; // Ajusta la ruta a tu UploadService

(async function testUploadService() {
  try {
    console.log('--- Test: createAttachmentFromUrl ---');

    // URL de ejemplo para probar. Ajusta a una imagen, audio o lo que quieras:
    const fileUrl = 'https://picsum.photos/300/300';

    // Llamamos a createAttachmentFromUrl
    const attachmentFromUrl = await UploadService.createAttachmentFromUrl(fileUrl);
    console.log('✅ Se creó attachment desde URL:');
    console.log(attachmentFromUrl);

    /*
    // EJEMPLO: Si quisieras probar con un archivo local:
    console.log('--- Test: createAttachment con archivo local ---');

    // Ruta a un archivo local de prueba
    const localFilePath = path.resolve('test-files/my-audio.mp3');
    const fileBuffer = fs.readFileSync(localFilePath);

    // Armamos el objeto "file" como lo recibiría un middleware de subida (multer)
    const file = {
      originalname: path.basename(localFilePath), // nombre original
      mimetype: 'audio/mpeg', // o el que corresponda
      buffer: fileBuffer,
      size: fileBuffer.length,
    };

    const attachmentLocal = await UploadService.createAttachment(file);
    console.log('✅ Se creó attachment desde archivo local:');
    console.log(attachmentLocal);
    */

    console.log('--- Test finalizado ---');
  } catch (error) {
    console.error('❌ Error en testUploadService:', error);
  }
})();
