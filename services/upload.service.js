import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import AWS from 'aws-sdk';
import slugify from 'slugify';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const prisma = new PrismaClient();

// AWS SDK Configuration
const spacesEndpoint = new AWS.Endpoint(process.env.SPACES_ENDPOINT);
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.SPACES_KEY,
  secretAccessKey: process.env.SPACES_SECRET,
});

const EXT_MAP = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
};

class UploadService {
  static async createAttachment(file, params = {}) {
    console.log('🚀 [UploadService] createAttachment started');
    try {
      const paramMetas = params.metas || {};
      const mimeType = file.mimetype;
      const acl = params.acl || 'public-read';

      console.log('🔍 MIME type detected:', mimeType);

      let extension = path.extname(file.originalname).toLowerCase();
      if (!extension) {
        console.log('⚠️ No extension found in original name, checking MIME map...');
        extension = EXT_MAP[mimeType] || '';
      }

      console.log('📌 File extension resolved:', extension);

      const baseName = path.basename(file.originalname, extension);
      const uuid = uuidv4();
      const rawFilename = `${uuid}-${baseName}${extension}`;
      const filename = slugify(rawFilename, { lower: true });

      console.log('📝 Filename after slugification:', filename);

      const date = new Date();
      const year = date.getFullYear();
      let month = date.getMonth() + 1;
      if (month < 10) month = '0' + month;

      const fileBuffer = file.buffer;
      const keyPath = `upload/${year}/${month}/${filename}`;

      console.log('📂 Key path for upload:', keyPath);

      const s3Params = {
        Bucket: process.env.SPACES_BUCKET_NAME,
        Key: keyPath,
        Body: fileBuffer,
        ACL: acl,
        ContentType: mimeType,
      };

      console.log('📤 Uploading to S3 with params:', s3Params);

      const data = await s3.upload(s3Params).promise();

      console.log('✅ Uploaded to DigitalOcean:', data);

      const attachment = await prisma.attachment.create({
        data: {
          name: file.originalname,
          slug: filename,
          url: data.Location,
          attachment: keyPath,
          mime: mimeType,
          size: file.size,
          source: 'digitalocean',
          acl,
          metas: {
            location: data.Location,
            s3: data,
            ...paramMetas,
          },
        },
      });

      console.log('✅ Attachment record created in DB:', attachment);

      return attachment;
    } catch (error) {
      console.error('❌ [UploadService] createAttachment error:', error);
      throw error;
    }
  }

  static async downloadAttachment(id) {
    try {
      console.log(`🔍 Downloading attachment with ID: ${id}`);
      const attachment = await prisma.attachment.findUnique({
        where: { id: parseInt(id) },
      });
      if (!attachment) throw new Error('Attachment not found');

      const s3Params = {
        Bucket: process.env.SPACES_BUCKET_NAME,
        Key: attachment.attachment,
      };

      const data = await s3.getObject(s3Params).promise();
      console.log('✅ Attachment downloaded:', data);

      return { attachment, data };
    } catch (error) {
      console.error('❌ [UploadService] downloadAttachment error:', error);
      throw error;
    }
  }

  static async createAttachmentFromUrl(url, params = {}) {
    console.log(`🚀 Creating attachment from URL: ${url}`);
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      const contentLength = parseInt(response.headers['content-length'] || '0', 10);

      const file = {
        originalname: url.split('/').pop(),
        mimetype: response.headers['content-type'] || '',
        buffer: Buffer.from(response.data),
        size: contentLength,
      };

      console.log('📥 File downloaded from URL:', file.originalname, file.mimetype);

      const attachment = await this.createAttachment(file, params);

      console.log('✅ Attachment from URL created successfully:', attachment);

      return attachment;
    } catch (error) {
      console.error('❌ [UploadService] createAttachmentFromUrl error:', error);
      throw error;
    }
  }
}

export default UploadService;
