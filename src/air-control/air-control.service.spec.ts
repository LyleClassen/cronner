import { Test, TestingModule } from '@nestjs/testing';
import { AirControlService } from './air-control.service';

describe('AirControlService', () => {
  let service: AirControlService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AirControlService],
    }).compile();

    service = module.get<AirControlService>(AirControlService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
