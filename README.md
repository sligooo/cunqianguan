# 存钱罐 · 双人记账小程序

两个人的月度记账网页：每月各自填预算，有支出就记一笔，实时看到余额、占比和备用池。纯网页、无需安装，两台手机访问同一个网址、共享同一份数据。

## 一、填写密钥（只需做一次）

1. 用电脑浏览器登录 [supabase.com](https://supabase.com)，打开你的项目。
2. 点左下角齿轮 ⚙️ **Project Settings** → 左侧 **API**。
3. 在 API 页面找到两项：
   - **Project URL**（形如 `https://abcdefghijk.supabase.co`）
   - **publishable key**（页面上的 "Publishable key"，形如 `sb_publishable_...`；老项目显示为 **anon public key**，形如 `eyJhbGciOi...`，两者都可以）
4. 用记事本/编辑器打开项目里的 `js/config.js`，把两个值填进引号里：

   ```js
   const SUPABASE_URL = "https://abcdefghijk.supabase.co";   // 粘贴 Project URL
   const SUPABASE_KEY = "sb_publishable_...";                // 粘贴 publishable key
   ```

5. 保存文件。密钥只存在这一个文件里，其他地方不用动。

> 没填密钥就打开网页，会停在"还差一步：填写密钥"的提示页，属正常现象。

## 二、部署到 Vercel（免费，约 5 分钟）

先把第一节的密钥填好再部署，这样部署完就能直接用。

1. **上传代码到 GitHub（网页操作，不用装任何软件）**
   1. 打开 [github.com](https://github.com) 并登录（没有账号就用邮箱注册一个）。
   2. 右上角 **＋ → New repository**，名字随便起（如 `cunqianguan`），Public/Private 都行，点 **Create repository**。
   3. 在建好的仓库页面点 **uploading an existing file**，把本项目**整个文件夹里的所有内容**（`index.html`、`css`、`js`、`icons`、`manifest.webmanifest`、`README.md`）拖进页面，点底部 **Commit changes**。
2. **部署**
   1. 打开 [vercel.com](https://vercel.com)，点 **Sign Up**，选 **Continue with GitHub** 用刚才的 GitHub 账号登录并授权。
   2. 进入后台后点 **Add New… → Project**。
   3. 在仓库列表找到 `cunqianguan`，点 **Import**。
   4. 配置页不用改任何东西（Framework Preset 保持 **Other**，不填构建命令），直接点 **Deploy**。
   5. 等几十秒出现 🎉 画面，点 **Visit** 或记下 `https://xxx.vercel.app` 这个网址——以后两台手机都访问它。
3. **以后改了文件怎么办**：在 GitHub 仓库网页里找到对应文件 → 点铅笔图标编辑 → **Commit changes**，Vercel 会自动重新部署，约 1 分钟生效。

## 三、手机"添加到主屏幕"（像 App 一样用）

- **iPhone**：必须用 **Safari** 打开网址 → 点底部中间的**分享按钮**（方框带向上箭头）→ 往下划找到 **添加到主屏幕** → 点右上角 **添加**。桌面上会出现"存钱罐"图标。
- **安卓（Chrome）**：用 Chrome 打开网址 → 点右上角 **⋮** 菜单 → 点 **添加到主屏幕**（有的机型显示"安装应用"）→ 确认。桌面上会出现图标。

从图标打开就是全屏体验，没有浏览器地址栏。

## 四、验收自检结果

对照需求文档验收清单逐条自检（✅ = 代码已实现并通过逻辑测试 / 静态走查）：

| # | 验收项 | 结果 |
|---|--------|------|
| 1 | 手机浏览器打开，底部 4 个 Tab，添加到主屏幕后全屏可用 | ✅ 底部 4 Tab（首页/记一笔/历史/设置），"记一笔"为中间凸起圆钮；manifest `display: standalone`，含 192/512 图标、theme-color、iOS safe-area |
| 2 | 首次打开能设置两人昵称和"我是谁" | ✅ 首次进入强制引导页；昵称存 `settings`，"我是谁"存 localStorage |
| 3 | 开启新月：填两人预算 → 首页出现剩余预算（个人 + 合计） | ✅ 两人预算必填；首页"本月剩余预算"含 A/B/合计三行 |
| 4 | 记一笔：默认本人、默认今天、默认本月预算来源；保存后首页数字立即变 | ✅ 默认选中本机主人、今天日期、"本月预算"；保存成功后立即重新拉取并刷新 |
| 5 | 自定义分类保存后出现在分类列表 | ✅ 选"其他"输入的新分类写入 `settings.custom_categories`，下次直接出现在选项里 |
| 6 | 另一台手机刷新后能看到对方刚记的账 | ✅ 所有读写直连 Supabase；每 30 秒自动轮询 + 切回页面时刷新（建议部署后两台手机实测一次） |
| 7 | 剩余 ≤20% 变黄、超支变红且允许继续记 | ✅ `remainCls` 逻辑经单元测试（含边界：恰好 20%、恰好 0、负数）；超支不拦截记账 |
| 8 | 编辑/删除记录后，预算与备用池数字正确联动 | ✅ 编辑时先回补旧 pool 扣款再按新值重扣；删除 pool 记录时退回对应池子 |
| 9 | 记一笔选"备用池"来源，池余额减少、月度剩余不变 | ✅ pool 来源只减 `pools.balance`；"本月剩余"统计只计 budget 来源（已单测验证） |
| 10 | 开启新月：弹确认框 → 剩余入池 → 旧月份进历史且只读 → 可填新预算 | ✅ 确认框列出每人剩余与结转后池余额；确认后归档、剩余（含负数）入池，随后进入新预算流程 |
| 11 | 历史月份可回看全部明细与统计 | ✅ 历史页按月份倒序；详情含预算、每人已花、分类统计、全部明细，只读无编辑入口 |
| 12 | 设置页可导出 JSON 备份 | ✅ 一键导出 settings + months + expenses + pools 全量 JSON 下载 |
| 13 | 无控制台报错；弱网写失败有提示 | ✅ `node --check` 通过，24 项逻辑单测全过；写失败弹 toast 且表单内容保留；未填密钥/CDN 加载失败均有引导页而非报错（建议部署后真机断网验证一次写入提示） |

> 说明：本次自检为代码级验证（语法检查 + 核心计算逻辑单元测试 + 逐条走查）。因密钥需你本人填写，联网相关条目（6、13 的真机部分）已在代码中实现，建议填密钥部署后按上表在手机上快速过一遍。

## 项目结构

```
├── index.html            # 入口页面（含底部 Tab 栏）
├── css/style.css         # 全部样式（移动优先）
├── js/config.js          # ← 唯一需要改的文件：填 Supabase 密钥
├── js/app.js             # 全部业务逻辑
├── manifest.webmanifest  # PWA 配置
└── icons/                # 主屏幕图标（192 / 512）
```
