/* Estrutura de custos (operação → custo → quem cobra → anormalidades → breakdown → como conferir)
 * e estrutura de pagamentos e controle (procedimento, risco do ICG e contramedida).
 * Conteúdo em pt / en / zh. Para atualizar a estrutura, edite as listas abaixo. */
const L = (pt, en, zh) => ({ pt, en, zh });

const PARTIES = {
  terminal: { color: "#2a78d6", name: L("Terminal Santos Brasil", "Santos Brasil terminal", "Santos Brasil 码头") },
  gov: { color: "#6250d6", name: L("Governo (Receita / Siscomex / Mercante)", "Government (Customs / Siscomex / Mercante)", "政府（海关 / Siscomex / 商船基金）") },
  carrier: { color: "#eb6834", name: L("Armador", "Shipping line", "船公司") },
  broker: { color: "#1baf7a", name: L("Despachante aduaneiro", "Customs broker", "报关行") },
  engineer: { color: "#e34948", name: L("Engenheiro / perito designado pela Receita", "Engineer appointed by Customs", "海关指定鉴定工程师") },
  transport: { color: "#eda100", name: L("Transportadora / operador logístico", "Trucking / logistics operator", "运输公司 / 物流运营商") },
  china: { color: "#8a8d93", name: L("Pago na China (matriz)", "Paid in China (HQ)", "中国总部支付") },
};

const KPI = {
  1: { name: L("KPI 1 · Storage", "KPI 1 · Storage", "KPI 1 · 堆存费"), color: "#1f6b34" },
  2: { name: L("KPI 2 · Demurrage", "KPI 2 · Demurrage", "KPI 2 · 滞箱费"), color: "#b35a00" },
  3: { name: L("KPI 3 · Customs costs", "KPI 3 · Customs costs", "KPI 3 · 清关费用"), color: "#1c5cab" },
};

/** Anormalidades da operação que geram ou aumentam custos. */
const ANOMALIES = {
  docs: L("Documento de embarque divergente (BL, invoice, packing list)", "Shipping documents with discrepancies (BL, invoice, packing list)", "装运单据不一致（提单、发票、装箱单）"),
  duimpLate: L("Atraso no registro da DUIMP", "Late DUIMP registration", "DUIMP 登记延误"),
  ncm: L("Erro de classificação (NCM), falta de licença/anuência", "Classification error (NCM), missing licence/consent", "归类错误（NCM）、缺少许可证/批准"),
  channel: L("Canal amarelo, vermelho ou cinza", "Yellow, red or grey customs channel", "黄色、红色或灰色通道"),
  mapa: L("Inspeção do MAPA (embalagem de madeira) mesmo em canal verde", "MAPA inspection (wooden packaging) even in green channel", "即使绿色通道也有农业部（MAPA）木质包装检验"),
  requests: L("Exigências da fiscalização e demora na resposta", "Customs officer requests and slow replies", "海关补充资料要求及回复延迟"),
  laudo: L("Exigência de laudo técnico / Ex-tarifário", "Technical report requirement / Ex-tariff", "要求技术鉴定报告 / Ex-tariff"),
  payLate: L("Pagamento ao terminal confirmado após as 16h", "Terminal payment confirmed after 4 p.m.", "下午4点后才确认向码头付款"),
  pickup: L("Falta de caminhão / agendamento / espaço na fábrica", "No truck / booking / space at the plant", "缺少卡车 / 预约 / 工厂空间不足"),
  unload: L("Fila de descarga na fábrica", "Unloading queue at the plant", "工厂卸货排队"),
  returnLate: L("Devolução do vazio fora do prazo livre", "Empty container returned after free time", "空箱超出免费期归还"),
};

/** Etapas da operação (fluxograma de importação) e custos gerados em cada uma. */
const STEPS = [
  { n: 1, name: L("Navio chega / descarga", "Vessel arrival / discharge", "船舶到港 / 卸货"), anomalies: ["docs"], costs: [
    { id: "freight", name: L("Frete internacional", "International freight", "国际运费"), party: "china", route: L("Pago pela matriz na China", "Paid by HQ in China", "由中国总部支付"),
      check: L("Frete da invoice/BL = valor usado na base de cálculo da DUIMP (CIF).", "Freight on invoice/BL = value used in the DUIMP (CIF) tax base.", "发票/提单运费 = DUIMP（CIF）计税基础中使用的金额。") },
    { id: "insurance", name: L("Seguro internacional", "International insurance", "国际保险"), party: "china", route: L("Pago pela matriz na China", "Paid by HQ in China", "由中国总部支付"),
      check: L("Apólice/valor declarado coerente com o CIF da DUIMP.", "Policy/declared value consistent with DUIMP CIF.", "保单/申报金额与 DUIMP 的 CIF 一致。") },
    { id: "afrmm", name: L("AFRMM / Marinha Mercante", "AFRMM (Merchant Marine fee)", "AFRMM 商船基金"), party: "gov", route: L("Sistema Mercante (débito via despachante)", "Mercante system (paid via broker)", "Mercante 系统（经报关行支付）"),
      check: L("25% do frete internacional; conferir com o frete do BL.", "25% of ocean freight; check against BL freight.", "国际运费的25%；与提单运费核对。") },
    { id: "tum", name: L("TUM / Mercante", "TUM / Mercante fee", "TUM / Mercante 费"), party: "gov", route: L("Sistema Mercante", "Mercante system", "Mercante 系统"),
      check: L("Valor fixo por conhecimento; 1 cobrança por BL.", "Fixed fee per BL; one charge per BL.", "每份提单固定费用；每份提单只收一次。") },
  ] },
  { n: 2, name: L("Presença de carga no terminal", "Cargo presence at terminal", "货物抵达码头"), anomalies: ["duimpLate"], kpiStart: 1, costs: [
    { id: "storageReg", name: L("Armazenagem regular (1º período, 15 dias)", "Regular storage (1st period, 15 days)", "常规堆存（第1期，15天）"), party: "terminal", kpi: 1, data: "storageFirst",
      route: L("Boleto/PIX à vista pelo ICG, antes da liberação", "Cash boleto/PIX via ICG, before release", "放行前通过 ICG 以 boleto/PIX 现付"),
      breakdown: [L("R$ 1.770,00 mínimo ou 0,31% do CIF + PIS/COFINS 9,25% + ISS 5% = R$ 2.064,14", "R$ 1,770.00 minimum or 0.31% of CIF + PIS/COFINS 9.25% + ISS 5% = R$ 2,064.14", "最低 R$1,770.00 或 CIF 的0.31% + PIS/COFINS 9.25% + ISS 5% = R$2,064.14")],
      check: L("Valor = tarifário (R$ 2.064,14 por contêiner ou 0,31% do CIF, o maior); período começa na presença de carga.", "Value = tariff (R$ 2,064.14 per container or 0.31% of CIF, whichever is higher); period starts at cargo presence.", "金额 = 费率表（每箱 R$2,064.14 或 CIF 的0.31%，取较高者）；从货物抵达开始计算。") },
    { id: "thc", name: L("Movimentação no terminal (THC)", "Terminal handling (THC)", "码头操作费（THC）"), party: "carrier", route: L("Fatura do armador", "Shipping line invoice", "船公司发票"),
      check: L("1 THC por contêiner, valor da tabela do armador.", "One THC per container, per carrier tariff.", "每箱一次 THC，按船公司费率。") },
  ] },
  { n: 3, name: L("Registro DI / DUIMP", "DI / DUIMP registration", "DI / DUIMP 登记"), anomalies: ["ncm", "docs"], kpiStart: 3, costs: [
    { id: "siscomex", name: L("Taxa Siscomex", "Siscomex fee", "Siscomex 费"), party: "gov", route: L("Débito automático no registro (despachante)", "Automatic debit at registration (broker)", "登记时自动扣款（报关行）"),
      check: L("Valor por DUIMP + adições; conferir no extrato da DUIMP.", "Fee per DUIMP + items; check on DUIMP statement.", "按 DUIMP 及项数计费；核对 DUIMP 明细。") },
    { id: "broker", name: L("Despachante aduaneiro", "Customs broker", "报关行"), party: "broker", route: L("Honorários + numerário pelo ICG", "Fees + cash advance via ICG", "通过 ICG 支付服务费及预付款"),
      check: L("Honorário fixo por processo (≈ R$ 230); numerário prestado contas.", "Fixed fee per process (≈ R$ 230); advance reconciled.", "每票固定服务费（约 R$230）；预付款需对账。") },
    { id: "licences", name: L("Anuências / licenças (se aplicável)", "Licences / consents (if applicable)", "许可证 / 批准（如适用）"), party: "gov", route: L("GRU / DARF", "GRU / DARF", "GRU / DARF 缴款单"),
      check: L("Só para NCM com anuência; guia vinculada ao processo.", "Only for NCMs requiring consent; slip linked to the process.", "仅适用于需批准的 NCM；缴款单需对应该票。") },
  ] },
  { n: 4, name: L("Parametrização (canal)", "Customs channel assignment", "海关通道分配"), anomalies: ["channel", "mapa"], costs: [
    { id: "channel", name: L("Definição do canal: verde / amarelo / vermelho / cinza", "Channel: green / yellow / red / grey", "通道：绿 / 黄 / 红 / 灰"), party: "gov", route: L("Sem custo direto", "No direct cost", "无直接费用"), trigger: true,
      check: L("Canal diferente de verde (ou MAPA) explica os custos da etapa 5 e o aumento da armazenagem.", "A non-green channel (or MAPA) explains step 5 costs and longer storage.", "非绿色通道（或 MAPA）解释第5步费用及堆存增加。") },
  ] },
  { n: 5, name: L("Conferência e desembaraço", "Inspection and clearance", "查验与清关"), anomalies: ["channel", "mapa", "requests", "laudo"], costs: [
    { id: "inspection", name: L("Despesas de inspeção no terminal", "Terminal inspection charges", "码头查验费用"), party: "terminal", kpi: 3, data: "extra_customs",
      route: L("Boleto/PIX à vista pelo ICG, antes da liberação", "Cash boleto/PIX via ICG, before release", "放行前通过 ICG 以 boleto/PIX 现付"),
      breakdown: [L("Escaneamento (inspeção não invasiva) — R$ 346,50", "Scanning (non-invasive inspection) — R$ 346.50", "扫描（非侵入式查验）— R$346.50"),
        L("Posicionamento do contêiner — R$ 389,21", "Container positioning — R$ 389.21", "集装箱移位 — R$389.21"),
        L("Retirada de lacre — R$ 83,18", "Seal removal — R$ 83.18", "拆封 — R$83.18"),
        L("Colocação de lacre — R$ 83,18", "Seal application — R$ 83.18", "加封 — R$83.18"),
        L("Abertura de contêiner — tarifa por operação", "Container opening — per operation", "开箱 — 按次计费"),
        L("Desova e ova (retirar/recolocar a carga) — varia", "Unstuffing / restuffing — varies", "拆箱与装箱 — 视情况"),
        L("Movimentações adicionais — quantidade × tarifa", "Additional moves — quantity × rate", "额外搬移 — 数量 × 费率")],
      check: L("Cada serviço = tarifário × quantidade; só deve existir com canal diferente de verde ou MAPA; quantidade de contêineres = contêineres inspecionados.", "Each service = tariff × quantity; only expected with non-green channel or MAPA; containers charged = containers inspected.", "每项服务 = 费率 × 数量；仅在非绿色通道或 MAPA 时出现；收费箱数 = 查验箱数。") },
    { id: "storageInsp", name: L("Armazenagem durante a inspeção (dias além do período livre)", "Storage during inspection (days beyond free period)", "查验期间堆存（超出免费期的天数）"), party: "terminal", kpi: 1, data: "extra_storage",
      route: L("Mesmo boleto do terminal", "Same terminal boleto", "同一码头账单"),
      breakdown: [L("Diária adicional R$ 212,52 ou 0,06% do CIF + impostos = R$ 247,84 por contêiner/dia", "Extra day R$ 212.52 or 0.06% of CIF + taxes = R$ 247.84 per container/day", "额外日费 R$212.52 或 CIF 0.06% + 税 = 每箱每天 R$247.84")],
      check: L("Dias cobrados = saída − entrada − 15; cruzar com datas do canal e das exigências para saber quem causou o atraso.", "Days charged = exit − entry − 15; cross with channel and request dates to see what caused the delay.", "计费天数 = 出场 − 进场 − 15；与通道及补充资料日期比对以确定延误原因。") },
    { id: "laudo", name: L("Exames e laudos técnicos", "Technical examinations and reports", "技术检验与鉴定报告"), party: "engineer", kpi: 3,
      route: L("Boleto do engenheiro pelo ICG (lançamento manual)", "Engineer's boleto via ICG (manual entry)", "通过 ICG 手工录入支付工程师账单"),
      check: L("Laudo exigido em exigência formal da fiscalização; valor do orçamento aprovado; nota fiscal do engenheiro.", "Report required by a formal customs request; value per approved quote; engineer's invoice.", "须有海关正式要求；金额与批准报价一致；工程师发票。") },
    { id: "rectif", name: L("Retificação documental", "Document rectification", "单证更正"), party: "broker", kpi: 3, route: L("Honorários do despachante", "Broker fees", "报关行服务费"),
      check: L("Causa da retificação registrada (erro de quem?); cobrar do responsável quando for erro de fornecedor.", "Root cause recorded (whose error?); recharge supplier when it is their error.", "记录更正原因（谁的错误）；如属供应商错误则向其追偿。") },
    { id: "fines", name: L("Multas aduaneiras", "Customs fines", "海关罚款"), party: "gov", kpi: 3, route: L("DARF", "DARF", "DARF 缴款单"),
      check: L("Auto de infração com base legal; avaliar defesa antes de pagar.", "Infraction notice with legal basis; assess defence before paying.", "须有法律依据的处罚通知；付款前评估申辩。") },
  ] },
  { n: 6, name: L("Liberação para coleta", "Release for pick-up", "放行提货"), anomalies: ["payLate"], costs: [
    { id: "release", name: L("Contêiner liberado (sem custo próprio)", "Container released (no own cost)", "集装箱放行（无单独费用）"), party: "terminal", trigger: true, route: L("Exige comprovante de pagamento ao terminal", "Requires proof of terminal payment", "需要向码头付款的凭证"),
      check: L("Comprovante enviado até 16h (liberação no mesmo dia); data de liberação ≤ dia seguinte ao desembaraço.", "Proof sent by 4 p.m. (same-day release); release date ≤ day after clearance.", "16点前发送付款凭证（当天放行）；放行日期 ≤ 清关次日。") },
  ] },
  { n: 7, name: L("Retirada do terminal", "Pick-up from terminal", "从码头提货"), anomalies: ["pickup"], kpiEnd: 1, costs: [
    { id: "loading", name: L("Carregamento bitrem/rodotrem", "Truck loading", "装车费"), party: "terminal", route: L("Mesmo boleto do terminal", "Same terminal boleto", "同一码头账单"),
      check: L("R$ 816,01 por contêiner retirado.", "R$ 816.01 per container picked up.", "每提一箱 R$816.01。") },
    { id: "road", name: L("Frete rodoviário e pedágios", "Road freight and tolls", "公路运费及过路费"), party: "transport", route: L("Fatura da transportadora (contrato)", "Trucking invoice (contract)", "运输公司发票（合同）"),
      check: L("Viagens faturadas = contêineres retirados; tarifa do contrato.", "Trips invoiced = containers picked up; contract rate.", "开票趟数 = 提货箱数；合同费率。") },
  ] },
  { n: 8, name: L("Entrega na fábrica / descarga", "Delivery at plant / unloading", "送达工厂 / 卸货"), anomalies: ["unload"], costs: [
    { id: "internal", name: L("Movimentação interna e descarga", "Internal handling and unloading", "厂内搬运与卸货"), party: "transport", route: L("Contrato do operador logístico", "Logistics operator contract", "物流运营商合同"),
      check: L("Contêineres descarregados = contêineres recebidos.", "Containers unloaded = containers received.", "卸货箱数 = 收货箱数。") },
  ] },
  { n: 9, name: L("Devolução do contêiner vazio", "Empty container return", "空箱归还"), anomalies: ["returnLate"], kpiEnd: 2, costs: [
    { id: "demurrage", name: L("Demurrage / detention (após o prazo livre)", "Demurrage / detention (after free time)", "滞箱费 / 滞期费（超过免费期）"), party: "carrier", kpi: 2,
      route: L("Fatura do armador pelo ICG", "Shipping line invoice via ICG", "通过 ICG 支付船公司发票"),
      check: L("Dias cobrados = devolução − descarga − prazo livre (40–42 dias); conferir com o comprovante de devolução (EIR).", "Days charged = return − discharge − free time (40–42 days); check against the return receipt (EIR).", "计费天数 = 归还 − 卸船 − 免费期（40–42天）；与还箱单（EIR）核对。") },
    { id: "return", name: L("Frete de devolução do vazio", "Empty return freight", "空箱回运费"), party: "transport", route: L("Fatura da transportadora", "Trucking invoice", "运输公司发票"),
      check: L("1 viagem por contêiner devolvido.", "One trip per container returned.", "每还一箱一趟。") },
  ] },
];

/** Procedimento de pagamento e controle. lane = quem executa. risk/counter destacam o ponto de risco do ICG. */
const LANES = {
  supplier: L("Fornecedor (terminal, despachante, engenheiro, armador)", "Supplier (terminal, broker, engineer, carrier)", "供应商（码头、报关行、工程师、船公司）"),
  comex: L("Comex GWM", "GWM Comex", "GWM 进出口部"),
  directors: L("Diretoria", "Directors", "总监"),
  icg: L("Sistema ICG", "ICG system", "ICG 系统"),
  bank: L("Banco / tesouraria", "Bank / treasury", "银行 / 财务"),
};
const PAY_STEPS = [
  { n: 1, lane: "supplier", title: L("Cobrança emitida", "Charge issued", "开出账单"),
    what: L("Santos Brasil envia o demonstrativo de cálculo e o boleto; despachante envia numerário; engenheiro envia boleto do laudo; armador envia fatura.", "Santos Brasil sends the calculation statement and boleto; broker sends cash request; engineer sends report boleto; carrier sends invoice.", "Santos Brasil 发送计费明细及 boleto；报关行发送预付款请求；工程师发送鉴定 boleto；船公司发送发票。"),
    check: L("O número IRA, BL, DUIMP e contêineres da cobrança existem no processo.", "IRA number, BL, DUIMP and containers on the charge exist in the process.", "账单上的 IRA 号、提单、DUIMP 及箱号与该票一致。"),
    evidence: L("Demonstrativo (.xlsx/PDF) importado no sistema", "Statement (.xlsx/PDF) imported in the system", "明细（.xlsx/PDF）已导入系统") },
  { n: 2, lane: "comex", title: L("Conferência da cobrança", "Charge verification", "核对账单"),
    what: L("Importar o demonstrativo neste sistema: soma × total do terminal, valores × tarifário, dias de armazenagem × datas do processo.", "Import the statement here: sum × terminal total, values × tariff, storage days × process dates.", "将明细导入本系统：合计 × 码头总额，金额 × 费率表，堆存天数 × 该票日期。"),
    check: L("Conferências automáticas sem alerta (✓ totais, ✓ tarifário).", "Automatic checks without warnings (✓ totals, ✓ tariff).", "自动核对无警告（✓ 合计，✓ 费率）。"),
    evidence: L("Página do processo → Pagamento e controle", "Process page → Payment & control", "该票页面 → 付款与控制") },
  { n: 3, lane: "comex", title: L("Breakdown e justificativa dos extras", "Extra-cost breakdown and justification", "额外费用明细与说明"),
    what: L("Classificar cada extra (KPI 1 storage / KPI 3 customs) e registrar o motivo: canal, exigência, MAPA, laudo, atraso de retirada.", "Classify each extra (KPI 1 storage / KPI 3 customs) and record the cause: channel, request, MAPA, report, late pick-up.", "对每项额外费用分类（KPI 1 堆存 / KPI 3 清关）并记录原因：通道、补充资料、MAPA、鉴定、提货延误。"),
    check: L("Todo extra tem motivo registrado; canal verde com inspeção tem MAPA confirmado.", "Every extra has a recorded cause; green channel with inspection has MAPA confirmed.", "每项额外费用均有原因；绿色通道有查验时已确认 MAPA。"),
    evidence: L("Campo “Motivo” e planilha Red Channel", "“Cause” field and Red Channel sheet", "“原因”字段及红色通道表") },
  { n: 4, lane: "directors", counter: true, title: L("E-mail de aprovação aos diretores", "Approval e-mail to directors", "向总监发送审批邮件"),
    what: L("CONTRAMEDIDA: enviar o resumo gerado pelo sistema (processo, valor, breakdown, motivo) e aguardar a confirmação por escrito antes de lançar.", "COUNTERMEASURE: send the system-generated summary (process, amount, breakdown, cause) and wait for written confirmation before entering the payment.", "对策：发送系统生成的摘要（单号、金额、明细、原因），在录入付款前等待书面确认。"),
    check: L("E-mail de aprovação arquivado; status “Aprovado” com data e aprovador.", "Approval e-mail filed; status “Approved” with date and approver.", "审批邮件已存档；状态为“已批准”并有日期和审批人。"),
    evidence: L("E-mail salvo na pasta do processo", "E-mail saved in the process folder", "邮件保存在该票文件夹") },
  { n: 5, lane: "icg", risk: true, title: L("Lançamento e pagamento no ICG", "Entry and payment in ICG", "在 ICG 录入并付款"),
    what: L("RISCO: o ICG permite pagar com o criador + 1 aprovador operacional, sem passar por diretor. Só lançar depois do passo 4.", "RISK: ICG allows payment with the creator + 1 operational approver, with no director. Enter only after step 4.", "风险：ICG 只需创建人 + 1 名操作审批人即可付款，无需总监。仅在第4步之后录入。"),
    check: L("Nº do ICG registrado; data do lançamento ≥ data da aprovação; valor lançado = valor aprovado.", "ICG number recorded; entry date ≥ approval date; amount entered = amount approved.", "已记录 ICG 编号；录入日期 ≥ 批准日期；录入金额 = 批准金额。"),
    evidence: L("Nº ICG / arquivo de remessa", "ICG number / remittance file", "ICG 编号 / 汇款文件") },
  { n: 6, lane: "bank", title: L("Banco: remessa e confirmação", "Bank: remittance and confirmation", "银行：汇款与确认"),
    what: L("Remessa ao banco e retorno com “Pagamento Confirmado”.", "Remittance to bank and return file “Payment confirmed”.", "向银行汇款并收到“付款已确认”回执。"),
    check: L("Retorno bancário confirmado; valor pago = valor aprovado; sem pagamento duplicado para o mesmo processo/serviço.", "Bank return confirmed; amount paid = amount approved; no duplicate payment for the same process/service.", "银行回执确认；付款金额 = 批准金额；同一票/服务无重复付款。"),
    evidence: L("Arquivo de retorno do banco", "Bank return file", "银行回执文件") },
  { n: 7, lane: "comex", title: L("Comprovante ao terminal e liberação", "Proof to terminal and release", "向码头发送凭证并放行"),
    what: L("Enviar o comprovante pelo portal / tesouraria do terminal até 16h para liberar no mesmo dia.", "Send proof via terminal portal / treasury by 4 p.m. for same-day release.", "16点前通过码头门户/财务发送凭证以便当天放行。"),
    check: L("Contêiner liberado no portal; pagamento após 16h = 1 dia a mais de armazenagem.", "Container released on portal; payment after 4 p.m. = one more day of storage.", "门户显示已放行；16点后付款 = 多一天堆存。"),
    evidence: L("Tela de liberação do portal", "Portal release screen", "门户放行页面") },
  { n: 8, lane: "comex", title: L("NF-e e conciliação", "Invoice (NF-e) reconciliation", "发票（NF-e）对账"),
    what: L("Conferir a NF-e com o demonstrativo aprovado. Divergências: contestar em até 24 horas úteis após a emissão.", "Check the NF-e against the approved statement. Discrepancies: dispute within 24 business hours of issue.", "将 NF-e 与批准的明细核对。如有差异：开票后24个工作小时内提出异议。"),
    check: L("NF-e = valor aprovado; contestação aberta dentro do prazo.", "NF-e = approved amount; dispute filed on time.", "NF-e = 批准金额；在期限内提出异议。"),
    evidence: L("NF-e anexada ao processo", "NF-e attached to the process", "NF-e 附于该票") },
  { n: 9, lane: "comex", title: L("KPIs e fechamento", "KPIs and closing", "KPI 与结案"),
    what: L("Registrar storage (KPI 1), demurrage (KPI 2) e customs costs (KPI 3); comparar custo por contêiner com a meta.", "Record storage (KPI 1), demurrage (KPI 2) and customs costs (KPI 3); compare cost per container with the target.", "记录堆存（KPI 1）、滞箱（KPI 2）和清关费用（KPI 3）；将每箱成本与目标比较。"),
    check: L("Custo regular por contêiner ≤ R$ 3.331,79 (verde) / R$ 3.887,37 (outros canais) ou desvio justificado.", "Regular cost per container ≤ R$ 3,331.79 (green) / R$ 3,887.37 (other channels) or deviation justified.", "每箱常规成本 ≤ R$3,331.79（绿色）/ R$3,887.37（其他通道），或偏差已说明。"),
    evidence: L("Painel deste sistema", "This system's dashboard", "本系统仪表板") },
];

const RISKS = [
  { id: "icg", level: 3, title: L("Pagamentos no ICG sem aprovação de diretor", "ICG payments without director approval", "ICG 付款无总监审批"),
    impact: L("Pagamentos indevidos, duplicados ou acima do tarifário sem visibilidade da diretoria.", "Undue, duplicate or above-tariff payments with no visibility for directors.", "不当、重复或高于费率的付款，总监无从知晓。"),
    counter: L("E-mail de aprovação aos diretores antes do lançamento (gerado pelo sistema) + status de aprovação registrado por processo.", "Approval e-mail to directors before entry (generated by the system) + approval status recorded per process.", "录入前向总监发送审批邮件（系统生成）+ 按票记录审批状态。") },
  { id: "breakdown", level: 2, title: L("Cobranças sem breakdown no sistema de pagamento", "Charges without breakdown in the payment system", "付款系统中费用无明细"),
    impact: L("Não dá para saber o que foi pago (armazenagem, inspeção, lacres…).", "Impossible to see what was paid (storage, inspection, seals…).", "无法知道支付了什么（堆存、查验、封条……）。"),
    counter: L("Importar o demonstrativo da Santos Brasil e conferir com o tarifário antes de pagar.", "Import the Santos Brasil statement and check it against the tariff before paying.", "付款前导入 Santos Brasil 明细并与费率核对。") },
  { id: "mapa", level: 2, title: L("Custos de inspeção em canal verde", "Inspection charges in green channel", "绿色通道出现查验费用"),
    impact: L("Pode ser MAPA (legítimo) ou cobrança indevida.", "May be MAPA (legitimate) or an undue charge.", "可能是 MAPA（合理）或不当收费。"),
    counter: L("Confirmar com o despachante/terminal se houve MAPA e registrar o motivo; senão, contestar.", "Confirm with broker/terminal whether MAPA occurred and record it; otherwise dispute.", "与报关行/码头确认是否有 MAPA 并记录；否则提出异议。") },
  { id: "late", level: 2, title: L("Pagamento ao terminal após 16h", "Terminal payment after 4 p.m.", "下午4点后向码头付款"),
    impact: L("Liberação no dia seguinte = mais 1 diária de armazenagem por contêiner.", "Next-day release = one more storage day per container.", "次日放行 = 每箱多一天堆存。"),
    counter: L("Programar pagamentos até 16h (PIX) e acompanhar a liberação.", "Schedule payments by 4 p.m. (PIX) and follow up the release.", "安排在16点前付款（PIX）并跟进放行。") },
  { id: "nfe", level: 1, title: L("NF-e divergente não contestada em 24h úteis", "NF-e discrepancy not disputed within 24 business hours", "NF-e 差异未在24个工作小时内提出异议"),
    impact: L("O terminal não aceita correção depois do prazo.", "The terminal does not accept corrections after the deadline.", "超过期限码头不接受更正。"),
    counter: L("Conciliar NF-e × demonstrativo em D+1.", "Reconcile NF-e × statement on D+1.", "D+1 核对 NF-e 与明细。") },
];

/** Quais custos cada anormalidade gera ou aumenta. */
const IMPACTS = {
  docs: ["rectif", "fines", "storageInsp"], duimpLate: ["storageInsp"], ncm: ["rectif", "fines", "licences", "inspection"],
  channel: ["inspection", "storageInsp", "laudo"], mapa: ["inspection", "storageInsp"], requests: ["storageInsp", "laudo"],
  laudo: ["laudo", "storageInsp"], payLate: ["storageInsp"], pickup: ["storageInsp", "demurrage"], unload: ["demurrage"], returnLate: ["demurrage"],
};
