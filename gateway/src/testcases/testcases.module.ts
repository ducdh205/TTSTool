import { Module } from '@nestjs/common';
import { TestcasesController } from './testcases.controller';

@Module({ controllers: [TestcasesController] })
export class TestcasesModule {}
