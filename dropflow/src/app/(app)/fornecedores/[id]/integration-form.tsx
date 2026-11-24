"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/action-form";
import { Field, Input, Select, Notice } from "@/components/ui";

type Cfg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TYPES = [
  { v: "manual", l: "Manual — sem integração", d: "Pedidos gerados para envio por e-mail/WhatsApp; produtos por cadastro manual." },
  { v: "file", l: "Arquivo — CSV, XML, planilha", d: "Catálogo e estoque por upload de arquivo; pedidos gerados para envio manual." },
  { v: "rest", l: "API do fornecedor (documentada)", d: "Requer a documentação oficial da API do fornecedor e credenciais fornecidas por ele." },
  { v: "simulated", l: "Simulado (somente modo teste)", d: "Fornecedor fictício para testar o fluxo completo." },
];

export function IntegrationForm({ action, type, config, hasSecret, mode }: { action: FormAction; type: string; config: Cfg; hasSecret: boolean; mode: string }) {
  const [t, setT] = useState(type);
  const c = config ?? {};
  const fm = c.catalog?.fieldMap ?? {};
  return (
    <ActionForm action={action} className="space-y-4">
      <Field label="Método de integração">
        <Select name="integration_type" value={t} onChange={(e) => setT(e.target.value)}>
          {TYPES.filter((x) => x.v !== "simulated" || mode === "test" || type === "simulated").map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
        </Select>
      </Field>
      <p className="text-sm text-slate-500">{TYPES.find((x) => x.v === t)?.d}</p>

      {t === "rest" && (
        <div className="space-y-5">
          <Notice tone="warning" title="Use apenas a documentação oficial do fornecedor">
            Preencha os campos conforme a documentação da API que o fornecedor disponibilizou. O DropFlow não presume endpoints: o que não for configurado não é chamado.
          </Notice>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="URL base da API (HTTPS) *"><Input name="baseUrl" defaultValue={c.baseUrl} placeholder="https://api.fornecedor.com.br/v1" /></Field>
            <Field label="Link da documentação oficial *"><Input name="documentationUrl" defaultValue={c.documentationUrl} placeholder="https://…" /></Field>
            <Field label="Autenticação">
              <Select name="authType" defaultValue={c.auth?.type ?? "bearer"}>
                <option value="bearer">Bearer token (Authorization)</option>
                <option value="header">Chave em cabeçalho</option>
                <option value="basic">Usuário e senha (Basic)</option>
                <option value="query">Chave na URL</option>
                <option value="none">Sem autenticação</option>
              </Select>
            </Field>
            <Field label="Nome do cabeçalho / parâmetro" hint="Ex.: X-Api-Key ou api_key"><Input name="authHeaderName" defaultValue={c.auth?.headerName ?? c.auth?.queryParam} /></Field>
            <Field label="Token / chave de API" hint={hasSecret ? "Já existe um segredo salvo (criptografado). Deixe em branco para manter." : "Armazenado criptografado"}><Input name="secret_token" type="password" autoComplete="off" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Usuário (Basic)"><Input name="secret_username" autoComplete="off" /></Field>
              <Field label="Senha (Basic)"><Input name="secret_password" type="password" autoComplete="off" /></Field>
            </div>
          </div>

          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-800">Catálogo</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Caminho" hint="ex.: /produtos"><Input name="catalogPath" defaultValue={c.catalog?.path} /></Field>
              <Field label="Lista de itens na resposta" hint="ex.: data.items (vazio = raiz)"><Input name="itemsPath" defaultValue={c.catalog?.itemsPath} /></Field>
              <Field label="Unidade de peso"><Select name="weightUnit" defaultValue={c.catalog?.weightUnit ?? "kg"}><option value="kg">kg</option><option value="g">g</option></Select></Field>
              <Field label="Parâmetro de página"><Input name="pageParam" defaultValue={c.catalog?.pageParam} placeholder="page" /></Field>
              <Field label="Parâmetro de tamanho"><Input name="pageSizeParam" defaultValue={c.catalog?.pageSizeParam} placeholder="per_page" /></Field>
              <Field label="Itens por página"><Input name="pageSize" type="number" defaultValue={c.catalog?.pageSize ?? 100} /></Field>
              <Field label="Cursor da próxima página" hint="se a API usar cursor"><Input name="nextCursorPath" defaultValue={c.catalog?.nextCursorPath} /></Field>
            </div>
            <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Campos do produto na resposta (use ponto para campos aninhados)</p>
            <div className="grid gap-3 sm:grid-cols-4">
              {[["sku", "SKU *"], ["title", "Nome *"], ["cost", "Preço de custo *"], ["stock", "Estoque"], ["description", "Descrição"], ["brand", "Marca"], ["gtin", "EAN"], ["images", "Imagens"], ["weight", "Peso"], ["length", "Comprimento"], ["width", "Largura"], ["height", "Altura"], ["parentSku", "SKU pai"], ["color", "Cor"], ["size", "Tamanho"], ["category", "Categoria"]].map(([k, l]) => (
                <Field key={k} label={l}><Input name={`fm_${k}`} defaultValue={fm[k]} /></Field>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-800">Estoque (opcional)</legend>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Caminho" hint="use {skus} para a lista"><Input name="stockPath" defaultValue={c.stock?.path} /></Field>
              <Field label="Lista de itens"><Input name="stockItemsPath" defaultValue={c.stock?.itemsPath} /></Field>
              <Field label="Campo SKU"><Input name="stockSkuField" defaultValue={c.stock?.skuField} /></Field>
              <Field label="Campo quantidade"><Input name="stockQtyField" defaultValue={c.stock?.quantityField} /></Field>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-800">Pedidos (opcional)</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Criar pedido (POST)" hint="ex.: /pedidos"><Input name="orderCreatePath" defaultValue={c.orders?.createPath} /></Field>
              <Field label="Cabeçalho de idempotência"><Input name="idempotencyHeader" defaultValue={c.orders?.idempotencyHeader ?? "Idempotency-Key"} /></Field>
              <Field label="Campo do nº do pedido na resposta"><Input name="responseIdPath" defaultValue={c.orders?.responseIdPath} /></Field>
              <Field label="Campo de status na resposta"><Input name="responseStatusPath" defaultValue={c.orders?.responseStatusPath} /></Field>
              <Field label="Consultar pedido (GET)" hint="use {id}"><Input name="statusPath" defaultValue={c.orders?.statusPath} /></Field>
              <Field label="Campo de status na consulta"><Input name="statusField" defaultValue={c.orders?.statusField} /></Field>
              <Field label="Mapa de status (JSON)" className="sm:col-span-3" hint='Status do fornecedor → DropFlow (confirmed, preparing, dispatched, rejected, cancelled). Ex.: {"APROVADO":"confirmed","ENVIADO":"dispatched"}'>
                <Input name="statusMap" defaultValue={c.orders?.statusMap ? JSON.stringify(c.orders.statusMap) : ""} />
              </Field>
            </div>
          </fieldset>
        </div>
      )}
      <SubmitButton>Salvar integração</SubmitButton>
    </ActionForm>
  );
}
