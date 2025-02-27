import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import AWS from 'aws-sdk';
import slugify from 'slugify';
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

class UploadService {

	/**
	 * @function createAttachment
	 * @description Uploads a file to an S3 bucket and creates an attachment record in the database.
	 * @param {Object} file - The file object to be uploaded.
	 * @param {string} file.originalname - The original name of the file.
	 * @param {string} file.mimetype - The MIME type of the file.
	 * @param {Buffer} file.buffer - The buffer containing the file data.
	 * @param {Object} [params={}] - Additional parameters for the upload.
	 * @param {string} [params.acl='public-read'] - The access control list for the uploaded file.
	 * @returns {Promise<Object>} - Returns a promise that resolves to an object containing the attachment and upload data.
	 * @throws {Error} - Throws an error if something goes wrong during the upload or database operation.
	 */
	static async createAttachment(file, params = {}) {
		try {

			const paramMetas = params.metas || {};

			// get the mime type of file
			const mimeType = file.mimetype;
			const acl = params.acl || 'public-read';

			// The file should go to /upload/[year]/[month]/[filename]
			const date = new Date();
			const year = date.getFullYear();
			let month = date.getMonth() + 1;

			// add padded zero to month
			if(month < 10) month = '0' + month;

			// append uuid to file original name
			const uuid = uuidv4();
			let filename = `${ uuid }-${ file.originalname }`;

			// slugify filename
			filename = slugify(filename, { lower: true });

			const fileBuffer = file.buffer;

			const s3Params = {
				Bucket: process.env.SPACES_BUCKET_NAME,
				Key: `upload/${ year }/${ month }/${ filename }`,
				Body: fileBuffer,
				ACL: acl,
				ContentType: mimeType,
			};

			// s3 upload with await
			const data = await s3.upload(s3Params).promise();

			// Create attachment in database
			return await prisma.attachment.create({
				data: {
					name: file.originalname,
					slug: filename,
					url: data.Location,
					attachment: `upload/${ year }/${ month }/${ filename }`,
					mime: mimeType,
					size: file.size,
					source: 'digitalocean',
					acl: acl,
					metas: {
						location: data.Location,
						s3: data,
						...paramMetas,
					},
				},
			});

		} catch(error) {
			throw error;
		}
	}

	/**
	 * @function downloadAttachment
	 * @description Downloads an attachment from an S3 bucket using its ID.
	 * @param {string|number} id - The ID of the attachment to download.
	 * @returns {Promise<Object>} - Returns a promise that resolves to an object containing the attachment and its data.
	 * @throws {Error} - Throws an error if the attachment is not found or if something goes wrong during the download process.
	 */
	static async downloadAttachment(id) {
		try {
			const attachment = await primate.prisma.attachment.findUnique({
				where: {
					id: parseInt(id),
				},
			});

			if(!attachment) throw new Error('Attachment not found');

			const s3Params = {
				Bucket: process.env.SPACES_BUCKET_NAME,
				Key: attachment.attachment,
			};

			const data = await s3.getObject(s3Params).promise();

			return {
				attachment,
				data,
			};

		} catch(error) {
			throw error;
		}
	}

	/**
	 * @function createAttachmentFromUrl
	 * @description Downloads a file from a given URL and uploads it to an S3 bucket, creating an attachment record in the database.
	 * @param {string} url - The URL of the file to be downloaded and uploaded.
	 * @param {Object} [params={}] - Additional parameters for the upload.
	 * @param {string} [params.acl='public-read'] - The access control list for the uploaded file.
	 * @returns {Promise<Object>} - Returns a promise that resolves to an object containing the attachment and upload data.
	 * @throws {Error} - Throws an error if something goes wrong during the download or upload process.
	 */
	static async createAttachmentFromUrl(url, params = {}) {
  // Descargamos el archivo
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
  });

  const contentLength = parseInt(response.headers['content-length'] || '0', 10);

  const file = {
    originalname: url.split('/').pop(),
    mimetype: response.headers['content-type'] || '',
    buffer: Buffer.from(response.data),
    size: contentLength, // <-- Asignar el tamaño desde la cabecera
  };

  // Luego llamamos createAttachment con ese objeto
  try {
    return await this.createAttachment(file, params);
  } catch (error) {
    console.error('Error creating attachment from URL:', error);
    throw error;
  }
}

}

export default UploadService;
