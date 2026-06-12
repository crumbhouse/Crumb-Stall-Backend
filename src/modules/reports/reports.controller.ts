import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { AuthenticatedUserGuard } from '../../common/auth/authenticated-user.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(AuthenticatedUserGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get(':type.csv')
  async exportCsv(@Param('type') type: string, @Res() response: Response) {
    const report = await this.reportsService.exportCsv(type);

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    response.send(report.content);
  }

  @Get(':type.xlsx')
  async exportXlsx(@Param('type') type: string, @Res() response: Response) {
    const report = await this.reportsService.exportXlsx(type);

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    response.send(report.content);
  }
}
