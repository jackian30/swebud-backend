import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { JwtAuthGuard } from '../auth/jwt.guard';

const uploadDir = join(process.cwd(), 'uploads');
mkdirSync(uploadDir, { recursive: true });

@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  @Post('images')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: uploadDir,
      filename: (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
        const safeExt = extname(file.originalname || '').toLowerCase() || '.jpg';
        cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${safeExt}`);
      },
    }),
    fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  image(@UploadedFile() file: any) {
    return { url: `/api/uploads/${file.filename}`, filename: file.filename };
  }
}
