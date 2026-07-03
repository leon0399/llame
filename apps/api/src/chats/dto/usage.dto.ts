import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UsageQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 365,
    default: 30,
    description: 'Window in days; the whole view is scoped to it (UTC).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;
}

export class UsageTotalsResponse {
  @ApiProperty() inputTokens!: number;
  @ApiProperty() outputTokens!: number;
  @ApiProperty() totalTokens!: number;
  @ApiProperty({
    description: 'Estimated USD (built-in price table), known turns only.',
  })
  costUsd!: number;
  @ApiProperty() turnsWithKnownCost!: number;
  @ApiProperty() turnsWithUnknownCost!: number;
}

export class UsageByModelResponse {
  @ApiProperty() model!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() totalTokens!: number;
  @ApiProperty() costUsd!: number;
}

export class UsageByDayResponse {
  @ApiProperty({ description: 'UTC date, YYYY-MM-DD.' })
  date!: string;
  @ApiProperty() totalTokens!: number;
  @ApiProperty() costUsd!: number;
}

export class UsageSummaryResponse {
  @ApiProperty()
  days!: number;

  @ApiProperty({ type: () => UsageTotalsResponse })
  total!: UsageTotalsResponse;

  @ApiProperty({ type: () => [UsageByModelResponse] })
  byModel!: UsageByModelResponse[];

  @ApiProperty({ type: () => [UsageByDayResponse] })
  byDay!: UsageByDayResponse[];
}
