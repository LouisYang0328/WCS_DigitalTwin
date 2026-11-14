# WCS 数字孪生与 S7 只读网关

本工程包含三维演示、PLC 设备配置页和 ASP.NET Core 8 S7 网关。选用 TC 模板，填写 PLC IP 和设备名称，即可建立连接并读取文档中的堆垛机反馈点。端口、CPU、Rack、Slot、DB 编号和起始字节均可按现场修改。

## 启动与接入

需要 .NET 8 SDK 或兼容 SDK；前端构建另需 Node.js 18+（没有 Node 时跳过构建，直接使用 `app/` 中已有产物，没有产物则回退旧版单页）。

```powershell
.\start.ps1
# 也可使用其他端口
.\start.ps1 -ListenUrl http://127.0.0.1:5081
# 现场不想构建前端（直接跑已有 app/ 产物）
.\start.ps1 -SkipWebBuild
# 上次的实例没停，自动接管 5080
.\start.ps1 -ForceRestart
```

`start.ps1` 会先检查 `web/node_modules`，缺依赖时执行一次 `npm install`，然后 `npm run build` 把 Vue 工程输出到 `app/`，最后启动网关。构建失败只告警，不阻断启动。npm 源默认用官方源，内网可传 `-NpmRegistry <你的镜像地址>`。

### 登录、角色与数据库

系统默认启用登录。首次启动会自动初始化 MySQL 库并创建超级账号 `sa`，初始密码为 `0000`；登录后请立即在“用户管理”中重置密码，再创建客户或工程师账号。

| 角色 | 可见能力 | 典型对象 |
| --- | --- | --- |
| 客户视图 `viewer` | 三维整体视图、数据看板、实时任务/报警摘要 | 客户、现场参观与管理大屏 |
| 运维工程师 `engineer` | 客户能力 + S7/Modbus 连接、点位模板、模拟 PLC、看板配置 | 后端/自动化维护人员 |
| 超级管理员 `super_admin` | 工程师能力 + 用户创建、停用、角色与密码重置 | 系统管理员 |

客户不会看到“设备连接”入口，也不会在选中设备时看到 PLC 原始地址明细；后端接口同样做权限校验，隐藏前端按钮不能绕过授权。密码使用 PBKDF2-SHA256 加盐哈希保存，登录 Cookie 为 HttpOnly 会话；停用账号或重置密码会撤销旧会话。

登录页（`web/src/components/LoginView.vue`）左侧为标题、库区规格与“接入能力”四格，右侧是 `LoginEquipmentDemo.vue` 的本地交互演示舱：机械手 R01、输送线 CV-02、AGV-03 可点选，支持暂停/运行、1×/2× 倍率与重置，页面上明确标注“本地交互 · 不连接 PLC”。该演示只在前端用定时器驱动动画与读数，不请求任何接口，也不代表现场状态。窄屏下演示舱与能力条会自动隐藏，保证手机端能直接看到登录表单。

数据库默认库名 `wcs_digital_twin`。连接与连接池均可由 `appsettings.json`、本机 `appsettings.Local.json` 或环境变量覆盖；环境变量优先级更高，例如：

```powershell
$env:MySql__Host='192.168.1.20'
$env:MySql__Port='3306'
$env:MySql__Database='wcs_digital_twin'
$env:MySql__UserId='wcs_app'
$env:MySql__Password='<数据库密码>'
$env:MySql__PoolMin='2'
$env:MySql__PoolMax='50'
$env:MySql__ConnectionTimeoutMs='5000'
$env:Security__SecureCookie='true'   # 通过 HTTPS 发布时开启
$env:Security__SessionHours='8'
```

`backend/WcsGateway/appsettings.Local.json` 已加入 `.gitignore`，只放本机连接。服务器不要使用该文件，改用上面的环境变量或密钥管理系统。

### 数据库初始化与迁移

网关启动时会自动执行幂等建库建表并补齐角色、默认看板配置；数据库短暂不可用时三维服务仍可启动，登录会提示稍后重试并持续初始化。离线部署可先手工执行：

```powershell
mysql -h 192.168.1.20 -P 3306 -u root -p < sql/001_platform_init.sql
```

脚本只创建结构与角色/默认看板，不保存明文密码；`sa` 在首次应用启动时按 `Security__BootstrapAdminPassword` 安全播种。迁移旧环境到服务器时先备份再恢复：

```powershell
mysqldump -h <旧库地址> -u root -p --databases wcs_digital_twin --single-transaction --routines --triggers > wcs_digital_twin_backup.sql
mysql -h <服务器地址> -u root -p < wcs_digital_twin_backup.sql
# 恢复后仍执行一次初始化，兼容新增表和默认配置
mysql -h <服务器地址> -u root -p < sql/001_platform_init.sql
```

### 停止服务

在运行 `start.ps1` 的窗口按 `Ctrl+C`；窗口已关或进程卡住时，另开一个 PowerShell 执行：

```powershell
.\stop.ps1                      # 结束 5080 上的实例并释放端口
.\stop.ps1 -ListenUrl http://127.0.0.1:5081
```

脚本启动前会检查端口：若 5080 仍被上一个实例占用，不再让 `dotnet` 抛端口冲突异常直接退出，而是提示占用进程并给出 `.\stop.ps1`、`-ForceRestart`、换端口三种处理方式，然后以退出码 1 结束。

未启动本地模拟 PLC 时，控制台会周期性打印 `S7 connection failed: TC01-SIM ...`。这是网关在按退避重连，不是进程退出，也不影响三维页面打开。

页面入口：

| 地址 | 内容 |
| --- | --- |
| `/`、`/index.html` | 登录页与三维现场（Vue 3 + Vite SPA，所有角色可登录） |
| `/devices`、`/simulator` | 设备配置页、模拟 PLC 控制页（SPA 前端路由，仅工程师和超级管理员可访问） |
| `/legacy.html` | 旧版单页（登录后可访问；引擎冻结快照，仅作对照与回退） |
| `/devices.html`、`/simulator.html` | 旧地址，301 重定向到 `/devices`、`/simulator`（保留 query） |

三维现场与工程页同属一个 SPA：切换路由不重载页面，三维引擎常驻后台并自动挂起渲染循环；楼层/视角/看板状态写入 URL hash（`#f=1&v=top&dash=1`），支持前进后退与深链分享。

改前端界面时用开发模式，热更新直接生效（仍需网关提供 `/api`）：

```powershell
.\start.ps1 -SkipWebBuild      # 另开一个终端跑网关
cd web; npm run dev            # 打开 http://localhost:5173
```

开发服务器会把 `/assets/*` 直接映射到仓库根目录，改样式或引擎脚本不用重新构建。

打开 [设备配置页](http://127.0.0.1:5080/devices)，保留默认 TC 模板，填写设备名称、IP，点击“保存并连接”。默认参数为 S7-1200、TCP 102、Rack 0、Slot 0、DB2000、起始 0、长度 70、500ms 轮询。连接设置必须与实际 PLC 匹配；网络和 PLC 访问权限具备时才可读取。

页面顶部按角色组织：**页面展示**和**数据看板**对所有登录用户开放；**设备连接**仅工程师和超级管理员可见并进入真实 PLC 配置或本地模拟 PLC。超级管理员可从右上角进入“用户管理”。看板支持配置标题、刷新周期、任务/完成率/库位目标，以及九个面板的显示与排序；配置保存到 MySQL 后对所有账号生效，客户账号只能查看。

### 127 本地 S7 模拟信号

未接现场 PLC 时，启动网关后打开 [S7 模拟 PLC 控制页](http://127.0.0.1:5080/simulator)：

1. 选择 TC01–TC05、CV01 或 CV02，点击启动并连接；也可点击“全部启动并连接网关”开启七台。各设备使用独立端口、内存和 S7 连接。
2. 手动输入报警、模式、可调度、载货状态、行走/提升/货叉坐标及其他反馈点，点击保存。支持全部 29 个 TC 点位；UInt16 为 0–65535，UInt32 为 0–4294967295，只接受整数。
3. 在页面查看所选设备的真实 S7 读回值和数据质量，再点击“查看三维效果”自动选中对应堆垛机。手动数据保持不变；切换“自动演示”可连续变化，保存输入会回到手动模式。各设备单独输入，互不覆盖。

| 设备 | 本地 S7 地址 | 网关设备名称 |
| --- | --- | --- |
| TC01 | `127.0.0.1:1102` | TC01-SIM |
| TC02 | `127.0.0.1:1103` | TC02-SIM |
| TC03 | `127.0.0.1:1104` | TC03-SIM |
| TC04 | `127.0.0.1:1105` | TC04-SIM |
| TC05 | `127.0.0.1:1106` | TC05-SIM |
| CV01（1F 输送线） | `127.0.0.1:1107` | CV01-SIM |
| CV02（2F 输送线） | `127.0.0.1:1108` | CV02-SIM |

连接参数：`127.0.0.1`、上表对应 TCP 端口（可自选空闲端口）、S7-1200、Rack `0`、Slot `0`、`DB2000`、起始 `0`、长度 `70`。模拟器随网关进程运行，默认不监听端口，只有点击启动后才绑定本机回环地址；不需要额外运行 Node.js。停止某台模拟器后，仅该设备显示重连/数据失效，其余继续运行。

三维模型用本地 PLC 的行走/提升毫米值按 `1 mm = 0.001 m` 演示定位，并显示载货和报警灯。建议行走 700–39300 mm、提升 700–19300 mm；超出范围只限制模型位置，原始点位仍完整显示。货叉 `5000 mm` 为中位，使用详情卡刻度展示。该坐标换算仅用于本地模拟，现场 PLC 仍需标定零点、比例和方向。输入仅修改模拟器内存，网关仍只执行 S7 读取。

### CV 输送线模拟

CV01 对应一楼，CV02 对应二楼，均使用 DB600，分别分为 4 / 2 个读取块；不使用 TC 的 DB2000。控制页按输送机段选择编号，输入状态、占货和托盘条码，并与各块的真实 S7 读回对照。应用只提交当前机段的修改，其他机段草稿继续保留；“恢复整个 PLC 初始值”会重置该楼全部机段。

本地模拟约定状态 `0=停止、1=运行、2=报警、3=离线`，占货 `0=无货、1=有货`。仅在读取正常且状态为 1、占货为 1 时，该段及扩展段滚筒转动；占货控制托盘显示，报警使对应机段显示报警轮廓。断连后该楼停止滚筒、隐藏模拟货物并标出失效值，另一楼继续运行。

点位名称和字节偏移从桌面两份 INFO 变量表导入：CV01 为 `101001–101100` 的 301 点，CV02 为 `202001–202055` 的 166 点。条码在本地采用 S7 `STRING[10]`（2 字节头 + 10 字节 ASCII），保留前导零；现场枚举、原采集器长度单位和编码仍需核对，不能直接套用模拟约定。原表地址中 String 的 DBW 只用于定位字节偏移，本地读回显示 DBB 地址。

一楼 `1005 / 1030 / 1052 / 1098` 仅有变量，控制页保留但标为未绑定模型；二楼图示设备 `2056` 缺来源变量，三维页显示未绑定，不虚构 PLC 值。显式映射见 `assets/conveyor-s7-mapping.js`，来源行号与原地址见 `docs/conveyor-s7-source-map.json`；需重新导入时运行 `python tools/import-cv-profiles.py`，只读源表，不修改源文件。普通启动无需 Python 或 Excel。

如需沿用独立的自动信号脚本，可另开终端运行（与内置模拟器使用不同端口，或先停止内置模拟器）：

```powershell
node tools/local-s7-demo.cjs
```

独立脚本只绑定 `127.0.0.1:1102`，提供真实 S7/TCP 握手与 DB Read。首次运行会在网关注册 `TC01-SIM` 并保存配置；详情卡显示报警、模式、可调度、载货台、行走/提升实时坐标和货叉位置。模拟数据周期性包含手动/维护、报警码 1001、可调度变化和运动坐标；网关响应的 `isSimulation=true` 与页面“本地模拟”标识用于区分现场 PLC。

停止本地模拟器后，已保存的 `TC01-SIM` 会进入重连/数据失效状态，不会自动用页面演示数据顶替；再次运行命令即可恢复。现场接入时删除或停用该本地配置，按实际 IP/端口创建 `TC01`。

API 也支持模板快捷创建，设备名与 IP 可替换为现场值：

```http
POST /api/s7/devices
Content-Type: application/json

{"name":"TC01","ipAddress":"192.168.0.10","profileId":"tc"}
```

创建返回设备 `id`。通过 `GET /api/s7/devices/{id}/tags` 获取各 DB 块的点位、完整地址、质量和最近成功时间。创建成功表示配置已保存，是否读到 PLC 请以设备详情的 `state`、块的 `quality` 和 `lastReadAt` 为准。

## 模块与职责

```text
backend/WcsGateway/
  Program.cs                  服务装配、页面入口、异常响应
  Api/S7Endpoints.cs          模板、设备配置、状态、点位 API（工程师/管理员）
  Api/PlatformEndpoints.cs    登录会话、用户权限、看板配置、客户只读遥测
  Configuration/              配置选项、校验、原子持久化、旧版迁移、平台服务装配
  Data/                       MySQL 连接池、幂等初始化、看板配置存储
  Security/                   PBKDF2 密码、数据库会话、角色授权
  S7/S7ConnectionManager.cs   设备生命周期和并发配置变更
  S7/S7ConnectionSession.cs   每 PLC 独立轮询、超时、块隔离、重连、质量
  S7/Transport/               S7NetPlus 只读适配器及可替换接口
  S7/Simulation/              本地 S7/TCP 模拟 PLC、内存点位和自动信号
  S7/Profiles/                点位模板定义、注册与校验
  S7/TcTagDecoder.cs          按模板执行大端 UInt16/UInt32 解码
  config/plc-profiles.json    可编辑的点位模板（非运行状态）
  data/connections.json       设备/DB 配置（页面保存）
assets/css/                   各页面样式（工程页样式已加 SPA 作用域前缀）
assets/js/api-client.js       HTTP 超时及错误处理
assets/js/devices-page.js     设备页逻辑工厂（initDevices，由 DevicesView 挂载驱动）
assets/js/simulator-page.js   模拟器逻辑工厂（initSimulator，启停、手动输入、自动演示、读回校验）
assets/js/twin-scene.js       三维场景、设备选择，并向 Vue 发布面板/看板状态
assets/js/legacy/twin-scene-legacy.js  旧版单页专用的冻结引擎快照（不再跟进功能）
assets/js/equipment/          工业货架、堆垛机、滚筒输送线、托盘货物与环境光照
web/                          Vue 3 + Vite 前端工程（SPA：三维现场 + 设备/模拟器路由）
web/src/router.js             前端路由与角色守卫（/、/devices、/simulator）
web/src/views/                TwinView（三维常驻视图）与 DevicesView / SimulatorView
web/src/components/           顶栏（全站唯一导航源）、左右面板、选中卡、数据看板、图表宿主、场景工具条
web/src/store/twin.js         引擎↔界面的状态通道（publish / callEngine）
web/src/charts/               echarts 懒加载与 7 张看板图的 option 构造器
web/src/engine/load-engine.js 按序装载 three.js 与 twin-scene.js
app/                          web/ 的构建产物，由网关作为站点首页托管
index.html                    旧版单页，未构建前端时可访问 /legacy.html
archive/spa-merge-2026-11/    SPA 收编前的静态 devices/simulator 页面归档（不再托管）
tools/local-s7-demo.cjs       127.0.0.1 本地 S7/TCP 模拟信号源
start.ps1 / stop.ps1          启动（构建前端 + 网关）与停止脚本
tests/                        解码/持久化、接口、真实 S7 协议模拟、场景检查
```

浏览器只访问网关。每个 IP/Port/Rack/Slot 组合只建立一个会话，多个 DB 共用连接且串行读取，各块独立计时和退避；不同 PLC 独立运行。配置变更串行提交，先成功保存再切换会话。错误配置文件阻止启动并保留原文件，不会静默清空配置。

### 前端渲染分层

三维引擎（`assets/js/twin-scene.js`）只负责场景、仿真与数据采集，不再写左右面板与看板的 DOM：

```text
引擎 --publish(path, value)--> web/src/store/twin.js（Vue 响应式状态）
                                        │
组件直接读状态渲染  <───────────────────┘
组件操作 --callEngine(name, ...)--> 引擎命令表（selectDevice / togglePause / openDash …）
```

- 发布按段进行（`left.kpis`、`left.devices`、`right.selection`、`dash.snapshot` 等），每段自带签名比对，420ms 节拍里内容没变就不惊动组件。
- 设备搜索这类纯展示逻辑留在组件里：引擎只发当前楼层的全量设备清单，筛选与计数在 `LeftPanel` 内完成。
- 选中对象发结构化字段（标题、label/value 行、S7 信号块），由 `SelectionCard` / `SignalBlock` 排版，不再拼 HTML。
- 看板的 7 张图由 `DashChart` 组件托管 echarts 实例（首次打开才加载 1MB 的 echarts），option 由 `web/src/charts/dash-charts.js` 按快照计算。
- 旧版单页 `/legacy.html` 使用冻结的 `assets/js/legacy/twin-scene-legacy.js`，仍在脚本里直接写 DOM，仅作回退，不再跟进改动。

## 后续如何配置

- 新增同协议堆垛机：新增设备、填写独立 IP，选 TC 模板。一个 PLC 管多个设备/DB 时，编辑现有连接并添加对应 DB 块。
- 修改连接、DB、读取周期：在设备页编辑保存，立即应用，并在重启后恢复。
- 修改点位名称、偏移、描述：修改 `backend/WcsGateway/config/plc-profiles.json`，重启网关。
- 新设备类型：在同一 JSON 的 `profiles` 中增加唯一 `id` 和点位表，重启后页面自动列出模板；支持 `UInt16`、`UInt32`、指定 `length` 的 ASCII S7 `String` 和 RAW。新协议通过 `IPlcClientFactory` / `IPlcClient` 增加适配器。

点位 `offset` 是相对于块 `startAddress` 的字节偏移。例如偏移 50 的 UInt32，块为 DB2050、起始 100 时，完整地址为 `DB2050.DBD150`。不执行自动对齐；模板校验会拒绝重叠、越界、重复名称、未知类型和读取长度不足。

连接配置继续使用 v2 格式；旧版单 DB 数组会在成功校验后自动迁移。`appsettings.json` 可配置监听地址、设备配置路径、模板文件路径、连接/读取超时、重连间隔及过期阈值。相对路径以工程根目录为基准，也支持绝对路径；环境变量采用 `Gateway__ConfigFile`、`S7__ReadTimeoutMs` 等 .NET 配置格式。

## TC 点位依据与数据质量

默认模板与 `功能模块拆解.md` 第 4.3 节及桌面 `TC.xlsx` 的“设备变量”表对应：29 个 `PLC_*` 反馈点，DB2000 的 0–69 字节，62–63 未定义，`PLC_RELEASEFINISH` 在 DBW64，`PLC_TASKNO` 在 DBD66。未配置 `WCS_*` 写入或握手动作。`PLC_LOAD` 沿用原表“备用3”，不当作载货状态；货叉位移保留原毫米值，不作为整机巷道坐标。

`quality` 为 `good`（新鲜成功值）、`unknown`（尚无成功值）、`bad`（连接/块失败或设备断开）、`stale`（过期或恢复连接后尚未重新读取）、`disabled`（块停用）。过期阈值为 `max(S7:StaleAfterMs, 3 × 块轮询周期)`。`isStale` 表示保留的数据当前已失效；`hasData` 仅代表曾成功读取过。页面会明确提示“上次成功值”，应用方应结合质量使用点位，不能只判断 `hasData`。

现有资料仅定义 TC01；TC02–TC05 必须分别核对现场 IP/DB 和信号一致性。三维页面把堆垛机详情卡绑定到 S7 点位并显示数据质量，本地模拟连接还会驱动模型行走、提升、载货和报警；现场 PLC 的运动绑定仍需核对零点、比例、方向与设备映射。

## 工业设备渲染

三维页面已按参考现场照片细化货架和堆垛机。货架包含镀锌开口 C 型钢立柱、贯通安装孔、侧面斜撑、背面拉杆、槽型横梁、成对承重轨、锚板与螺栓；空库位透空显示。堆垛机包含黄色双立柱框架、上下轨道、行走轮组、电机机柜、升降链索、导向轮、橙色载货台护栏、收拢双叉和黑黄警示条。仍沿用全库 5 台共享物理设备与连续 10 层货架，不随楼层切换复制模型。

页面底部可用“堆垛机特写”查看机构、“货架结构”隐藏货物查看钢结构，也可手动切换“货物”“编号”。货物使用木托盘、分箱纸箱和打包带，空库位仍可点击。模型按米制参数生成并采用实例化/静态合并，材质和反射环境在本地生成，没有外部模型或网络贴图依赖。外观依据参考照片，具体截面、机构尺寸及现场位置仍需 CAD/实测确认；运动数据沿用现有仿真。

输送线按滚筒机参考照片细化为镀锌侧架、圆柱金属滚筒、轴承、双侧链传动、链轮、驱动电机/减速箱、橙色护罩、连接螺栓、支腿与调平脚。滚筒轴向按映射后的机段长短边决定，1F/2F 的 152 个图纸设备编号和同编号扩展段仍保留。转接段显示静态正交链条机构；实际机构形式待现场设备资料确认。所有段共享楼层级实例批次，选择与报警采用独立轮廓，不会改变其他设备共用的金属材质。

“输送线特写”可聚焦所选设备或当前楼层的转接设备，也可输入编号定位。输送面默认高度为 `CFG.conveyorSurfaceH = 0.56` 米，移动载荷采用带叉孔的木托盘、纸箱和打包带，底面与输送面留有小间隙。未编号连接桥沿用原有位置，纵向补段只填设备之间的间隙，避免重复铺设两套滚筒。CAD 和真实运行信号尚未接入这些机械细节。

一楼 `1090` 为拆盘机、`1091` 为码盘机，使用独立的空托盘拆叠机构模型，保留原机段位置、底部滚筒和 CV01 的 `101090 / 101091` 点位。模型包含四柱钢架、上横梁、托盘导向、升降滑架、承托叉、传动护罩、侧面围护、电控箱、急停与传感器，以及带板缝和叉孔的空木托盘。点击设备编号后可用“输送线特写”查看整机；编号标牌与详情区会显示设备名称。

机构比例参照通用设备资料：[LEWCO 拆叠盘机规格](https://conveyors.lewcoinc.com/wp-content/uploads/2024/03/Pallet-Dispenser-Stacker-Spec-Sheet.pdf)、[SOCO 托盘输送设备目录](https://www.socosystem.com/demo/infocenter/files/images/pdf/files/pallethandling_uk.pdf#page=64)。现有尺寸与机构为适配场景的示意，精确复刻仍需现场照片或图纸。盘垛层数是结构展示，不作为 PLC 库存数量；输送面单个空托盘按占货反馈显示，机构小行程演示随有效运行信号推进，暂停、报警或数据失效时停止。没有新增虚构的升降位置或拆叠计数点位。

场景采用铺满窗口的画布和可收起的监控侧栏；“沉浸视图”收起侧栏，“现场”切换到输送区附近的平视视角。“厂房环境”可开关外围墙体、高窗、钢梁、天窗和灯具，观察侧墙按相机方位剖切；环境仅为渲染背景，不纳入设备编号、货位容量或相机自动适配范围。

车间氛围按夜班工业厂房调光：冷色天光半球光做垂直衰减（货架顶部亮、底部沉），灯具有 25 组巷道 LED 加 18 组开放区高跨灯具（输送线、后侧通道同规格、同高度、同一批灯点），覆盖整个车间而不是只照输送线；灯具带自发光灯罩、加法混合辉光点和均匀分布的地面光斑，每巷道再补一个暖色点光源做颜色填充。空气中 620 颗粉尘缓慢漂移，门头有绿色疏散指示，卸货口放置空托盘垛与纸箱垛。灯罩、光斑全部为本地生成的加法混合材质，不写入景深、不遮挡设备点选，关闭“厂房环境”时一并隐藏。巷道地面画了黄色安全线，地面材质改为带颗粒与伸缩缝的抛光混凝土。

灯光刻意不做局部光锥或单点高亮：车间照明应当整体均匀，只有局部亮斑会让画面在旋转视角时像频闪。滚筒表面的明暗带也降到细密低对比（4 组条纹、亮度差约 22/255），保证“看得出在转”但不会闪。

输送线按“有载才转”运行：滚筒表面带机加工明暗带（含同步粗糙度贴图），只有压着托盘的机段才转动，空线段保持静止——与现场一致，也避免整厂空转造成误判。每个托盘在建场时就解析出自己会经过的机段，主循环按托盘的实时位置把线段加入运行集合，只对这些机段重算滚筒矩阵（旋转量施加在实例局部 Y 轴，贴图随机身一起转）；空线段不写矩阵、不改缓冲区。托盘到端头会短暂停留再离开，停留期间该段也停转；暂停仿真时所有机段立即停住。接口为 `assets/js/equipment/conveyor-model.js` 的 `updateMotion(dt, speed, runningIds)`，`runningIds` 为携带托盘的机段 id 集合。

画质提供“流畅 / 均衡 / 精细”三档。均衡与精细使用与现有 Three.js r149 匹配的官方 EffectComposer、SSAO 和抗锯齿组件，增强接触阴影、钢构层次与边缘清晰度；流畅使用直接渲染。后处理缺依赖或不可用时自动回退，保持页面可操作。厂房、画质和沉浸切换不修改设备状态、任务、库位占用或 PLC 信号；界面显示的 FPS 为当前页面实际帧间隔估算值。调试时可用 `?q=performance|balanced|high` 直接指定画质。

取景按“面板之外真正露出来的画布”计算：`syncFraming()` 量左右面板与顶栏、工具条的占位，用 `camera.setViewOffset()` 把主体平移到露出区域的中心，`applyView()` 再用这块区域的半视角折算相机距离，因此货架两端不会压在半透明面板下面。切换沉浸视图后等面板过渡结束（`transitionend` + 兜底定时器）重新取景，窗口尺寸变化同样重算。拾取走 `projectionMatrixInverse`，视锥平移不影响点击命中。想看改动前的整画布取景可加 `?frame=full` 做对比。

画面精度做了四处收口：渲染像素比档位提到 1 / 1.5 / 2 三档（低端机由帧率降档兜底回收）；程序生成的墙面、镀锌、滚筒贴图补上 mipmap 与各向异性过滤，远景不再是闪动的摩尔纹；地坪贴图加密到 512 并兼作凹凸图，墙面竖向压条从 0.65 米减到 2.6 米，避免细条在远处糊成网格；SSAO 接触阴影强度由 0.25 提到 0.38、半径 0.34，梁柱夹角才有暗部。

真实感调校集中在“不要把金属洗白”：天光 0.62→0.3、主光 0.78→1.2、环境反射统一压到 0.68（`WcsWarehouseLighting.applyReflectance`），雾起点由 96 米推到 132 米，钢架基色和粗糙度整体压深一档；货物纸箱改牛皮纸色（暖色与冷灰钢架拉开色相差），巷道暖光点光源 0.62→0.82，地面出现成组光斑而不是一片灰白。

后处理组件打包在 `assets/vendor`，运行无需访问 CDN，也不额外加载另一份 Three.js 引擎。组件来源与许可见该目录说明；场景集成位于 `assets/js/rendering/postprocessing.js`，厂房工厂位于 `assets/js/equipment/warehouse-environment.js`。

性能做了两处“不掉画质”的收口，实测总览视角三角形从 291 万降到 140 万、绘制调用从 606 降到 428：

- **微件按距离整批显隐**。螺栓、轴销、链节、链轮、打包带这类毫米级零件，总览时是亚像素，却占了近一半三角形——它们按楼层合批成实例网格，一个批次横跨整个厂房，视锥剔除拿它没办法。现在建场时给批网格打 `userData.detailTier = 'micro'`（`rack-model.js` / `conveyor-model.js` / `inventory-model.js`），主循环按相机到楼层的最近点距离整批 `visible` 切换，带 14 米滞回区间防闪（`DETAIL_LOD`：流畅 42/54、均衡 58/72、精细 76/90 米）。巷道、输送线特写与第一视角都在阈值内，看到的是完整细节。
- **纯拾取体不参与渲染**。库位、输送段、堆垛机的点击体材质是 `colorWrite:false`，画出来什么都没有却每帧各占一次绘制调用（152 个输送段 × 2~3 个渲染通道）。raycaster 不检查 `visible`，所以直接把它们设成不可见，点选、第一视角落点判定照旧。

帧耗时（1600×900，软件渲染环境，绝对值会放大数倍，看比例）：直接渲染 56→31 毫秒，均衡档 97→63 毫秒。主线程有约一半时间在等 GPU，JS 侧开销集中在绘制提交，因此“减调用、减三角形”比“减计算”更有效。阴影贴图仍按档位隔帧刷新——再降到每 3 帧实测收益落在噪声里，却会让移动中的堆垛机阴影滞后约 100 毫秒，故保持 2 帧。

顶部“第一视角”进入工人视角：光标变准星，在画布上点一块地面（地坪或 2F 平台都算）即把工人放到该点，相机升到该处 1.62 米眼高，拖拽环视、`W/A/S/D` 与方向键行走、滚轮沿视线前进、`ESC` 或切楼层返回总览。站立点用蓝色圆环加朝向楔形标出，总览时也能看到人在哪。就位时的朝向由 `fpvAim()` 决定：站在巷道里或设备就在脚边（小于 2.4 米）时顺着厂房长轴看，否则面向最近设备并把俯仰角对准它的台面，避免一睁眼就是一堵墙。

右侧“视野周边设备”按同层过滤（2F 平台不会把脚下 1F 的输送机算进来，堆垛机跨层始终参与），列出 22 米内最近的 8 台，标出距离与相对方位（正前方/左前方/右侧…），点击直接出设备卡片，相机停在原地不动。第一视角下设备点选不再触发相机聚焦，剖切也切回四面墙全开，人是站在厂房里而不是悬在模型外。取景偏移（`setViewOffset`）在第一视角下归零，眼高视角按整张画布成像。

货架立柱采用距离 LOD：远景保留相同外廓的开口 C 型钢，近景恢复贯通安装孔，避免在总览反复绘制亚像素孔洞。显示细节切换不会改变实例数量、位置、货位或点选索引。需要重建后处理依赖时运行 `node tools/build-postfx.cjs`；构建临时文件保存在被忽略的 `tests/artifacts/vendor-build`，普通启动不需要 Node 或 npm。

PLC 应具备兼容的以太网 S7 访问能力，核对 TCP 102、CPU/Rack/Slot、DB 访问权限及非优化 DB 设置；具体设置由现场 PLC 工程确认。S7NetPlus 的连接与字节读取接口见[项目官方文档](https://github.com/S7NetPlus/s7netplus/wiki)。

## API 与检查

除 `/api/health` 和 `/api/auth/login` 外，接口均需登录。`/api/s7/**`、模拟器与看板写接口要求工程师或超级管理员；`/api/users/**` 仅超级管理员；客户角色只能访问三维只读遥测和看板配置。

| 路由 | 用途 |
| --- | --- |
| `GET /api/health` | 网关进程、数据库与只读标识 |
| `POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout` | 登录、当前会话、退出 |
| `GET/POST /api/users`、`PUT /api/users/{id}/status`、`PUT /api/users/{id}/password`、`DELETE /api/users/{id}` | 用户创建、启停、密码重置与受控删除（仅超级管理员；sa 不可删除） |
| `GET/PUT /api/dashboard/config` | 看板标题、目标、刷新周期、九个面板显隐和排序 |
| `GET /api/telemetry/devices`、`/{id}` | 客户三维视图使用的脱敏只读设备与点位值 |
| `GET /api/s7/profiles`、`/{id}` | 模板目录和定义（维护角色） |
| `GET/POST /api/s7/devices` | 状态摘要、创建配置（维护角色） |
| `GET/PUT/DELETE /api/s7/devices/{id}` | 详情、编辑、删除连接配置（维护角色） |
| `POST /api/s7/devices/{id}/connect`、`/disconnect` | 启用/停止轮询并持久化（维护角色） |
| `GET /api/s7/devices/{id}/tags` | 按块分组的点位 JSON，包含完整 DB 地址（维护角色） |
| `GET /api/s7/simulator` | 本地模拟器状态和全部内存点位（维护角色） |
| `POST /api/s7/simulator/start`、`/stop` | 启停本地 TCP 监听；start 接收 `{ "port": 1102 }` |
| `POST /api/s7/simulator/connect` | 启动模拟器并注册/启用对应网关连接，返回 `deviceId` |
| `PUT /api/s7/simulator/values` | 原子修改模拟内存：`{ "values": { "PLC_ERROR": 1001, "PLC_LOCATX": 15000 } }`，自动切手动 |
| `PUT /api/s7/simulator/mode`、`POST /api/s7/simulator/reset` | 切换 `{ "mode": "manual" }` / `auto`，或恢复手动初值 |
| `GET /api/s7/simulators` | 五台 TC 与两台 CV 的状态和点位快照 |
| `/api/s7/simulators/{code}` 及其子路由 | 指定 TC01–TC05、CV01 或 CV02 的状态、start/stop/connect/values/mode/reset |
| `POST /api/s7/simulators/connect-all` | 批量启动并连接，支持 `{ "mode": "auto", "codes": ["CV01", "CV02"] }`，不传 codes 时连接全部七台，逐台返回成功或失败 |

旧的单数 `/api/s7/simulator` 接口继续指向 TC01，保留原有脚本兼容性。

设备列表不传原始字节或点位数据，详情接口才返回。网页服务只公开入口页面和 `assets`，不提供后端源码或配置文件的静态下载；客户遥测接口进一步去掉 IP、端口、Rack/Slot 和原始 DB 地址，只保留三维联动所需的设备状态与点位值。

```powershell
.\tests\run-checks.ps1
```

检查脚本使用随机本机端口、独立配置和临时 S7 协议模拟器，自动停止所属测试进程，不修改现场设备配置。覆盖模板解码/校验/扩展、持久化与迁移、多设备/多 DB、真实 S7 握手和读取、坏 DB 隔离、断连重连、过期质量以及原有三维布局交互。输出与日志保留于 `tests/artifacts`。模拟器验证不能替代现场真机验收。
