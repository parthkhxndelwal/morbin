"use client";

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatINR, formatINRCompact } from "@/lib/format";

const config = {
  gross: { label: "Ticket sales", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Last 30 days of ticket sales (excluding convenience fees), IST days. */
export function SalesChart({
  data,
}: {
  data: { date: string; grossPaise: number; tickets: number }[];
}) {
  const total = data.reduce((s, d) => s + d.grossPaise, 0);
  const points = data.map((d) => ({ date: d.date, gross: d.grossPaise / 100, tickets: d.tickets }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales, last 30 days</CardTitle>
        <CardDescription>
          {total > 0 ? `${formatINR(total)} in ticket sales` : "No sales in the last 30 days"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <AreaChart data={points} margin={{ left: 4, right: 4 }}>
            <defs>
              <linearGradient id="fillGross" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-gross)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-gross)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(v: string) =>
                new Date(`${v}T00:00:00+05:30`).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  timeZone: "Asia/Kolkata",
                })
              }
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(v) =>
                    new Date(`${v}T00:00:00+05:30`).toLocaleDateString("en-IN", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      timeZone: "Asia/Kolkata",
                    })
                  }
                  formatter={(value) => formatINRCompact(Number(value) * 100)}
                  indicator="line"
                />
              }
            />
            <Area
              dataKey="gross"
              type="monotone"
              fill="url(#fillGross)"
              stroke="var(--color-gross)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
