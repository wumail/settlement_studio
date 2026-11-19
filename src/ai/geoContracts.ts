import { z } from 'zod';

/** 通用外部地理导入契约（与任意宿主后端解耦，仅认 JSON） */
export const GeoBootstrapPayloadSchema = z.object({
  elevM: z.number(),
  slopeDirDeg: z.number().default(0),
  slopeMagM: z.number().min(0).default(12),
  query: z.object({
    lon: z.number().optional(),
    lat: z.number().optional(),
    spanM: z.number().min(600).max(8000).optional(),
  }).optional(),
  regionNote: z.string().optional(),
  suggestedRivers: z.array(z.object({
    id: z.string(),
    label: z.string().default(''),
    widthStartM: z.number().min(6).max(600).optional(),
    widthEndM: z.number().min(6).max(600).optional(),
    localPoints: z.array(z.tuple([z.number(), z.number()])).min(2),
  })).default([]),
});

