import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import {
  differenceInMinutes,
  format,
  isAfter,
  isBefore,
  parse,
  parseISO,
} from 'date-fns';
import { tuyaApi } from 'tuya-cloud-api';

type AreaInfo = {
  events: {
    end: string;
    note: string;
    start: string;
  }[];
  info: {
    name: string;
    region: string;
  };
  schedule: {
    days: {
      date: string;
      name: string;
      stages: string[][];
    }[];
    source: string;
  };
};

@Injectable()
export class AirControlService {
  private readonly logger = new Logger(AirControlService.name);

  client_id = process.env.TUYA_ID; // Replace with your Access ID
  secret = process.env.TUYA_SECRET;
  aircon_id = process.env.AIRCON_ID;

  esp_licence_key = process.env.ESP_LICENCE_KEY;
  esp_area_id = process.env.ESP_AREA_ID;

  nextLoadSheddingTime: Date;
  constructor() {
    this.logger.debug('TUYA_ID:', this.client_id);
    this.logger.debug('TUYA_SECRET:', this.secret);
    this.logger.debug('AIRCON_ID:', this.aircon_id);
    this.logger.debug('ESP_LICENCE_KEY:', this.esp_licence_key);
    this.logger.debug('ESP_AREA_ID:', this.esp_area_id);

    this.loadsheddingScheduleUpdate();
  }

  @Cron(CronExpression.EVERY_3_HOURS)
  async loadsheddingScheduleUpdate() {
    try {
      const { data } = await axios.get(
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

      this.nextLoadSheddingTime = this.nextLoadShedding(data, new Date());
      this.logger.log('NEXT LOADSHEDDING:', this.nextLoadSheddingTime);
    } catch (error) {
      this.logger.error(
        'Something went wrong fetching ESP Schedule data!',
        error,
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleAircon() {
    try {
      await tuyaApi.authorize({
        apiClientId: this.client_id,
        apiClientSecret: this.secret,
        serverLocation: 'eu',
      });

      const airconOn = await this.isAirconOn();
      this.logger.log('Aircon is on: ', airconOn);
      if (airconOn && this.nextLoadSheddingTime) {
        const minDiff = differenceInMinutes(
          this.nextLoadSheddingTime,
          new Date(),
        );
        this.logger.debug('Loadshedding at: ', this.nextLoadSheddingTime);
        this.logger.debug('Minutes Til Power off:', minDiff);
        if (minDiff <= 5) {
          this.logger.log('Turning Aircon Off');
          tuyaApi.sendCommand({
            deviceId: this.aircon_id,
            commands: [{ code: 'switch', value: false }],
          });
        }
      }
    } catch (error) {
      this.logger.error('Aircon Check Failed:', error);
    }
  }

  async isAirconOn() {
    const airconDetails = await tuyaApi.getDeviceStatus({
      deviceId: this.aircon_id,
    });

    return airconDetails.find((details) => details.code === 'switch').value;
  }

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

  findUpcomingStartTimeAsString(
    timeRanges: string[],
    currentTime: Date,
  ): string {
    const today = format(currentTime, 'yyyy-MM-dd');
    let upcomingStartTime: string | null = null;

    for (const range of timeRanges) {
      const [startTime] = range.split('-');

      // Construct a full date-time string for comparison
      const fullStartTimeString = `${today} ${startTime}`;
      const startTimeDate = parse(
        fullStartTimeString,
        'yyyy-MM-dd HH:mm',
        new Date(),
      );

      if (isAfter(startTimeDate, currentTime)) {
        upcomingStartTime = startTime;
        break;
      }
    }

    // If no future start time found for today, take the first start time for the next day
    if (!upcomingStartTime) {
      upcomingStartTime = timeRanges[0].split('-')[0];
    }

    return upcomingStartTime;
  }

  nextLoadShedding(areaInfo: AreaInfo, currentTime: Date) {
    const currentEvent = areaInfo.events[0];

    const stage = parseInt(currentEvent.note.match(/\d+/)?.[0] ?? '0');
    const eventStart = parseISO(currentEvent.start);
    const eventEnd = parseISO(currentEvent.end);
    console.log('Stage:', stage);

    console.log('eStr', eventStart);
    console.log('eend', eventEnd);

    const isCurrentlyLoadshedding =
      isAfter(currentTime, eventStart) && isBefore(currentTime, eventEnd);

    console.log('isCurrentlyLoadshedding:', isCurrentlyLoadshedding);

    if (isCurrentlyLoadshedding) {
      const daySchedule = areaInfo.schedule.days[0];

      console.log('daySchedule', daySchedule);

      const stageSchedule = daySchedule.stages[stage - 1];

      console.log('stageSchedule', stageSchedule);

      const nextTime = this.findUpcomingStartTimeAsString(
        stageSchedule,
        currentTime,
      );
      console.log('nextTime ', nextTime);

      const nextPossible = parse(
        `${daySchedule.date} ${nextTime}`,
        'yyyy-MM-dd HH:mm',
        new Date(),
      );

      return isAfter(nextPossible, currentTime) ? nextPossible : undefined;
    }

    const daySchedule = areaInfo.schedule.days.find(
      (day) => day.date === format(eventStart, 'yyyy-MM-dd'),
    );

    console.log('daySchedule', daySchedule);

    const stageSchedule = daySchedule.stages[stage - 1];

    console.log('stageSchedule', stageSchedule);

    const nextTime = this.findUpcomingStartTimeAsString(
      stageSchedule,
      currentTime,
    );

    return parse(
      `${daySchedule.date} ${nextTime}`,
      'yyyy-MM-dd HH:mm',
      new Date(),
    );
  }
}
