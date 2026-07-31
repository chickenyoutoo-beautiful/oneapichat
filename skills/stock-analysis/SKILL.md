---
name: stock-analysis
description: A股股票分析 — 实时行情/历史K线/技术指标/资金流向/龙虎榜/北向资金/K线图生成/综合诊断。数据源: 东方财富(10秒缓存)。Use for stock queries, technical analysis, market overview, sector flow, and generating K-line charts.
version: 1.0.0
metadata:
  oneapichat:
    tools: [stock_realtime, stock_kline, stock_sector_flow, stock_dragon_tiger, stock_north_flow, stock_diagnosis, stock_indicators, stock_chart, stock_market_overview, get_current_time, web_search]
    priority: high
    emoji: "📈"
    triggers: [股票, 行情, 股价, A股, 炒股, K线, 技术分析, 龙虎榜, 北向资金, 资金流向, 板块, 大盘, 指数, 上证, 深证, 创业板, 茅台, 平安银行, 宁德时代, 比亚迪, 中际旭创, 紫金矿业, 股票分析, 看看股票, 查股票, 股票行情, 买入, 卖出, 持仓, 自选股, 诊股, 技术指标, MACD, KDJ, RSI, 均线, 布林带, 复权, 日K, 周K, 月K, 分时, 5分钟K, 市场概览, 市场情绪, 热点板块, 机构动向, 游资, 主力, 净流入, 净买入, 投资, 股市, 牛市, 熊市]
---

# 📈 A股股票分析 (v1.0)

A股全链路分析工具集 — 实时行情、历史K线、技术指标、资金流向、龙虎榜、北向资金、K线图生成。

**数据源**: 东方财富 HTTP API (push2.eastmoney.com / push2his.eastmoney.com)
**缓存**: 10秒内存缓存，减少 API 调用
**覆盖**: 沪深A股 + 北交所 + 主要指数

## ⏰ 时间感知策略

**强制规则**: 开始分析前先调用 `get_current_time` 获取当前精确时间。

### 交易时段感知
| 时段 | 时间 | 数据状态 | 策略 |
|------|------|----------|------|
| 🟢 连续竞价 | 9:30-11:30, 13:00-14:57 | 实时更新 | 可直接引用最新价 |
| 🟡 集合竞价 | 9:15-9:25, 14:57-15:00 | 集合竞价 | 标注"集合竞价" |
| 🔴 盘后 | 15:00后 / 周末 | 收盘数据 | 标注"收盘数据" |
| ⚫ 休市 | 周末/节假日 | 上一交易日 | 标注"上一交易日收盘" |

### 时效性原则
1. **盘后数据标注日期**: 所有行情数据标注获取日期
2. **K线数据标注周期**: 日K/周K/月K需明确标注
3. **资金流向标注时段**: 北向资金标注"截至HH:MM"

## 何时使用

- 用户问某只股票的价格/涨跌/行情
- 用户说"看看K线"/"技术分析"/"技术指标"
- 用户问"大盘怎么样"/"市场情绪"/"热点板块"
- 用户问"龙虎榜"/"北向资金"/"主力资金"
- 用户说"画个K线图"/"生成图表"
- 用户问"XX股票怎么样"/"帮我看看这只股票"
- 用户说"买入"/"卖出"/"持仓分析"
- 用户问"哪个板块资金流入最多"

## 工具使用指南

### 1. 实时行情 — `stock_realtime`

获取个股最新价格、涨跌幅、成交额、PE、市值等。

```
stock_realtime(symbol="000001")
→ 返回: {name, price, change_pct, open, high, low, volume, amount, turnover, pe, market_cap, ...}
```

**参数**:
- `symbol` (必填): 股票代码, 如 `000001`, `600519`, `300750`

**输出格式**:
```
📈 平安银行 (000001) 实时行情

🔴📈 最新价: 11.52  涨跌幅: +2.13%  涨跌额: +0.24
📊 今开: 11.28  最高: 11.53  最低: 11.18  昨收: 11.28
💰 成交量: 139.62万手  成交额: 15.95亿  换手率: 0.72%
📐 市盈率(动): 3.85  总市值: 2236亿
```

### 2. 历史K线 — `stock_kline`

获取个股历史OHLCV数据。

```
stock_kline(symbol="600519", period="daily", count=60, adjust="qfq")
```

**参数**:
- `symbol` (必填): 股票代码
- `period`: `daily`(日K,默认) / `weekly`(周K) / `monthly`(月K) / `5`/`15`/`30`/`60`(分钟K)
- `adjust`: `qfq`(前复权,默认) / `hfq`(后复权) / `""`(不复权)
- `count`: 条数(默认120)
- `start`/`end`: 日期范围 `YYYYMMDD` (可选)

### 3. 技术指标 — `stock_indicators`

计算 MA/MACD/KDJ/RSI/BOLL 五大技术指标。

```
stock_indicators(symbol="300750", count=120)
→ 返回最近5个周期的指标值
```

**指标说明**:
| 指标 | 字段 | 信号 |
|------|------|------|
| 均线 | MA5/MA10/MA20/MA60 | 金叉(上穿)=买入, 死叉(下穿)=卖出 |
| MACD | DIF/DEA/MACD | 金叉=买入, 死叉=卖出, 柱线由负转正=弱转强 |
| KDJ | K/D/J | K>80=超买, K<20=超卖, J>100=严重超买 |
| RSI | RSI6/RSI12/RSI24 | >70=超买, <30=超卖, 背离=反转信号 |
| 布林带 | BOLL_UP/MID/DN | 触上轨=超买, 触下轨=超卖, 收口=变盘 |

### 4. K线图生成 — `stock_chart`

生成暗色主题K线分析图(PNG), 返回图片URL。

```
stock_chart(symbol="000001", period="daily", count=60, indicators="ma,macd,volume")
→ 返回: {chart_url: "/oneapichat/uploads/stock_charts/stock_xxx.png", ...}
```

**参数**:
- `symbol` (必填): 股票代码
- `period`: `daily`/`weekly`/`monthly`
- `count`: K线条数(默认60)
- `adjust`: `qfq`/`hfq`/`""`
- `indicators`: `ma,macd,volume`(默认全部) / `ma,volume` / `ma,macd` / `ma`

**输出格式**:
```
📈 平安银行 (000001) K线分析图 (daily, 60条)

![K线图](/oneapichat/uploads/stock_charts/stock_xxx.png)
```

### 5. 板块资金流向 — `stock_sector_flow`

获取行业/概念板块主力资金净流入。

```
stock_sector_flow(sector_type="2")  → 行业板块TOP30
stock_sector_flow(sector_type="3")  → 概念板块TOP30
```

### 6. 龙虎榜 — `stock_dragon_tiger`

获取龙虎榜数据(机构/游资买卖明细)。

```
stock_dragon_tiger()           → 今天
stock_dragon_tiger(date="20260730")  → 指定日期
```

### 7. 北向资金 — `stock_north_flow`

获取沪深股通实时净流入。

```
stock_north_flow()
→ 返回: {sh_connect: {net_inflow, ...}, sz_connect: {net_inflow, ...}, total_net_inflow}
```

### 8. 个股诊断 — `stock_diagnosis`

获取个股关键指标一览。

```
stock_diagnosis(symbol="600519")
```

### 9. 市场概览 — `stock_market_overview`

获取主要指数实时行情。

```
stock_market_overview()
→ 返回: 上证/深证/创业板/科创50/上证50/沪深300/中证500 等8个指数
```

## 分析工作流

### 工作流A: 个股全面分析

当用户问"XX股票怎么样"/"帮我看看XX"时:

```
1. get_current_time()           → 获取当前时间(判断交易时段)
2. stock_realtime(symbol="XX")  → 实时行情
3. stock_indicators(symbol="XX") → 技术指标
4. stock_diagnosis(symbol="XX")  → 综合诊断
5. [可选] stock_chart(symbol="XX") → 生成K线图
6. [可选] web_search("XX股票 最新消息 2026年7月") → 搜索相关新闻
```

**输出模板**:
```
📊 XX股票 (代码) 综合分析报告

📈 实时行情 (截至 YYYY-MM-DD HH:MM)
最新价: XX.XX  涨跌幅: +X.XX%
今开/最高/最低: XX/XX/XX
成交额: X.XX亿  换手率: X.XX%

📐 技术信号
• 均线: MA5=XX MA10=XX MA20=XX → [多头排列/空头排列/交织]
• MACD: DIF=XX DEA=XX → [金叉/死叉/柱线变化]
• KDJ: K=XX D=XX J=XX → [超买/超卖/中性]
• RSI6: XX → [超买/超卖/中性]
• 布林带: 上轨XX 中轨XX 下轨XX → [位置判断]

💡 综合判断
[多空信号总结]

⚠️ 风险提示
• 以上分析仅供参考, 不构成投资建议
• 股市有风险, 投资需谨慎
```

### 工作流B: 市场全景分析

当用户问"大盘怎么样"/"今天市场如何"时:

```
1. get_current_time()
2. stock_market_overview()     → 主要指数
3. stock_sector_flow("2")      → 行业资金流向
4. stock_north_flow()          → 北向资金
5. stock_dragon_tiger()        → 龙虎榜
```

### 工作流C: 技术面深度分析

当用户问"技术分析"/"看看K线"时:

```
1. stock_kline(symbol="XX", count=120)   → 历史K线
2. stock_indicators(symbol="XX", count=120) → 技术指标
3. stock_chart(symbol="XX", count=60)    → 生成图表
```

### 工作流D: 资金面分析

当用户问"资金流向"/"主力在买什么"时:

```
1. stock_sector_flow("2")      → 行业资金
2. stock_north_flow()          → 北向资金
3. stock_dragon_tiger()        → 龙虎榜
```

## 股票代码速查

| 市场 | 代码前缀 | 示例 |
|------|----------|------|
| 上海主板 | 60xxxx | 600519(茅台), 601318(平安) |
| 上海科创 | 68xxxx | 688981(中芯国际) |
| 深圳主板 | 00xxxx | 000001(平安银行), 000858(五粮液) |
| 创业板 | 30xxxx | 300750(宁德时代), 300059(东方财富) |
| 北交所 | 43/83/87 | 830799(艾融软件) |
| 指数 | 000001(上证), 399001(深证), 399006(创业板) | — |

## 注意事项

1. **数据延迟**: 行情数据可能有1-10秒延迟(缓存)
2. **历史K线不稳定**: `push2his.eastmoney.com` 间歇性返回空响应, 已内置curl兜底+重试
3. **复权选择**: 长期分析建议用前复权(qfq), 短期可用不复权
4. **免责声明**: 所有分析仅供参考, 必须标注"不构成投资建议"
5. **交易时段**: 盘后数据为收盘数据, 需标注"收盘"
6. **北向资金**: 盘中实时累计, 盘后固定为当日总额
7. **龙虎榜**: 仅交易日有数据, 周末/节假日无数据
