import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { differenceInMinutes, format, isAfter } from 'date-fns';
import { tuyaApi } from 'tuya-cloud-api';

@Injectable()
export class AirControlService {
  private readonly logger = new Logger(AirControlService.name);

  client_id = process.env.TUYA_ID; // Replace with your Access ID
  secret = process.env.TUYA_SECRET;
  aircon_id = process.env.AIRCON_ID;

  esp_licence_key = process.env.ESP_LICENCE_KEY;
  esp_area_id = process.env.ESP_AREA_ID;

  todaySchedule: any = {};
  currentStage = 0;
  constructor() {
    this.logger.debug('TUYA_ID:', this.client_id);
    this.logger.debug('TUYA_SECRET:', this.secret);
    this.logger.debug('AIRCON_ID:', this.aircon_id);
    this.logger.debug('ESP_LICENCE_KEY:', this.esp_licence_key);
    this.logger.debug('ESP_AREA_ID:', this.esp_area_id);

    this.loadsheddingScheduleUpdate();
    this.loadsheddingStageUpdate();
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async loadsheddingScheduleUpdate() {
    try {
      const areaInfo = await axios.get(
        'https://developer.sepush.co.za/business/2.0/area',
        {
          params: {
            id: this.esp_area_id,
          },
          headers: {
            token: this.esp_licence_key,
          },
        },
      );

      const {
        schedule: { days },
      } = areaInfo.data;

      this.todaySchedule = days[0];

      this.logger.log('Today Schedule: ', days[0]);
    } catch (error) {
      this.logger.error(
        'Something went wrong fetching ESP Schedule data!',
        error,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async loadsheddingStageUpdate() {
    try {
      const areaInfo = await axios.get(
        'https://developer.sepush.co.za/business/2.0/status',
        {
          headers: {
            token: this.esp_licence_key,
          },
        },
      );

      const {
        status: { capetown },
      } = areaInfo.data;

      this.currentStage = parseInt(capetown.stage);
      this.logger.log('Current Stage: ', capetown.stage);
    } catch (error) {
      this.logger.error('Something went wrong fetching ESP Stage data!', error);
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleAircon() {
    await tuyaApi.authorize({
      apiClientId: this.client_id,
      apiClientSecret: this.secret,
      serverLocation: 'eu',
    });

    const airconOn = await this.isAirconOn();
    this.logger.log('Aircon is on: ', airconOn);
    if (airconOn && this.currentStage > 0) {
      const currentStageTimes =
        this.todaySchedule.stages[this.currentStage + 1];
      this.logger.log('Current Stage Times', currentStageTimes);

      const offTime = this.findUpcomingTimeWithin30Mins(currentStageTimes);

      if (offTime) {
        this.logger.log('Setting Timer for:', offTime);
        this.startTimer(offTime);
      }
    }
  }

  async isAirconOn() {
    const airconDetails = await tuyaApi.getDeviceStatus({
      deviceId: this.aircon_id,
    });

    return airconDetails.find((details) => details.code === 'switch').value;
  }

  // Utility function to create a Date object from a time string for today
  createTime = (time: string): Date => {
    const [hours, minutes] = time.split(':').map(Number);
    const now = new Date();
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hours,
      minutes,
    );
  };

  startTimer = (startTime: Date) => {
    const now = new Date();
    const delay = startTime.getTime() - now.getTime(); // Milliseconds until the start time

    setTimeout(() => {
      this.logger.log('Timer ended at: ', format(new Date(), 'HH:mm:ss'));
      tuyaApi.sendCommand({
        deviceId: this.aircon_id,
        commands: [{ code: 'switch', value: false }],
      });
    }, delay);
  };

  // Function to find the upcoming time range
  findUpcomingTimeWithin30Mins = (timeRanges: string[]): Date | null => {
    const now = new Date();

    for (const range of timeRanges) {
      const [startTimeStr] = range.split('-');
      const startTime = this.createTime(startTimeStr);

      if (isAfter(startTime, now)) {
        // Check if difference is 30 minutes or less
        const diff = differenceInMinutes(startTime, now);
        if (diff <= 30) {
          // Return the start time in HH:mm format if within 30 minutes
          return startTime;
        }
        break; // Exit loop since we found the next upcoming time but it's more than 30 mins away
      }
    }

    return null; // No upcoming time within 30 minutes found
  };
}
