"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";

const brl = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function RevenueChart({ data }: { data: { day: string; revenue: number; profit: number }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f172a" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#0f172a" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#059669" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#059669" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="day" tickFormatter={day} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tickFormatter={brl} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={72} />
          <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(l) => day(String(l))} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="revenue" name="Faturamento" stroke="#0f172a" strokeWidth={2} fill="url(#rev)" />
          <Area type="monotone" dataKey="profit" name="Lucro estimado" stroke="#059669" strokeWidth={2} fill="url(#prof)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OrdersChart({ data }: { data: { day: string; orders: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="day" tickFormatter={day} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <Tooltip labelFormatter={(l) => day(String(l))} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
          <Bar dataKey="orders" name="Pedidos" fill="#10b981" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
