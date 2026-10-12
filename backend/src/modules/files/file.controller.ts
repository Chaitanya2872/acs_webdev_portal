import { FastifyReply, FastifyRequest } from 'fastify';
import { createSuccessResponse } from '../../utils/response';
import { FileService } from './file.service';

export class FileController {
  constructor(private readonly fileService: FileService) {}

  async createUploadRequest(request: FastifyRequest<{ Body: { folderName: string; fileName: string; contentType: string; fileSize: number } }>, reply: FastifyReply) {
    const result = await this.fileService.createUploadRequest(request.body);
    reply.code(201);
    return createSuccessResponse(result);
  }

  async listFiles(request: FastifyRequest<{ Querystring: { folderName?: string; limit?: number; continuationToken?: string } }>, reply: FastifyReply) {
    const result = await this.fileService.listFiles(request.query);
    reply.code(200);
    return createSuccessResponse(result.files);
  }

  async getFile(request: FastifyRequest<{ Params: { '*': string } }>, reply: FastifyReply) {
    const key = request.params['*'];
    const result = await this.fileService.getFile(key);
    reply.code(200);
    return createSuccessResponse(result);
  }

  async replaceFile(request: FastifyRequest<{ Params: { '*': string }; Body: { fileName?: string; contentType?: string; fileSize?: number } }>, reply: FastifyReply) {
    const result = await this.fileService.replaceFile(request.params['*'], request.body);
    reply.code(200);
    return createSuccessResponse(result);
  }

  async deleteFile(request: FastifyRequest<{ Params: { '*': string } }>, reply: FastifyReply) {
    const result = await this.fileService.deleteFile(request.params['*']);
    reply.code(200);
    return result;
  }
}
