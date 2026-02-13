import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    CqrsModule.forRoot(),
    DatabaseModule,
    // Domain modules registered here as the project grows
  ],
})
export class AppModule {}
