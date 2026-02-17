import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';

interface CreateAuditEventInput {
  terminalId: string;
  type: string;
  sequenceNum?: number;
  sentAt?: Date;
  payload: Record<string, unknown>;
}

@Injectable()
export class AuditEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateAuditEventInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        terminalId: input.terminalId,
        type: input.type,
        sequenceNum: input.sequenceNum,
        sentAt: input.sentAt,
        payload: input.payload as object,
      },
    });
  }
}
