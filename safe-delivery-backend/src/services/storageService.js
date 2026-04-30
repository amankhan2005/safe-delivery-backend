import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, bucketName } from '../config/aws';
import { v4 as uuidv4 } from 'crypto';
import { extname } from 'path';

/**
 * Upload a file buffer to S3.
 * @param {Object} file - multer file object { buffer, mimetype, originalname }
 * @param {string} folder - S3 folder prefix
 * @returns {Promise<{ url: string, key: string }>}
 */
const uploadToS3 = async (file, folder = 'uploads') => {
  const ext = extname(file.originalname) || '.jpg';
  const key = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2)}${ext}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  await s3Client.send(command);

  const url = `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
  return { url, key };
};

/**
 * Delete a file from S3 by key.
 * @param {string} key
 */
const deleteFromS3 = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    await s3Client.send(command);
  } catch (error) {
    console.error('S3 delete error:', error.message);
  }
};

export default { uploadToS3, deleteFromS3 };