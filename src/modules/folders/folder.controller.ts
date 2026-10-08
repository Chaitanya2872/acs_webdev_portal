import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, createSuccessResponse } from '../../utils/response';
import { FolderService } from './folder.service';

export class FolderController {
  constructor(private readonly folderService: FolderService) {}

  async createFolder(request: FastifyRequest<{ Body: { folderName: string } }>, reply: FastifyReply) {
    const { folderName } = request.body;

    try {
      const result = await this.folderService.createFolder(folderName);
      reply.code(201);
      return createSuccessResponse(result);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INVALID_REQUEST', 'Invalid folder request.', 400);
    }
  }

  async listFolders(_request: FastifyRequest, reply: FastifyReply) {
    const folders = await this.folderService.listFolders();
    reply.code(200);
    return createSuccessResponse(folders);
  }

  async getFolderContents(request: FastifyRequest<{ Params: { '*': string } }>, reply: FastifyReply) {
    const folderName = request.params['*'];

    try {
      const result = await this.folderService.getFolderContents(folderName);
      reply.code(200);
      return createSuccessResponse(result);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INVALID_REQUEST', 'Invalid folder request.', 400);
    }
  }
}
