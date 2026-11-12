# 卫戍协议战绩查询 Web

独立的《明日方舟》卫戍协议查询网页。用森空岛 App 扫码或粘贴 Cred 绑定，切换游戏角色和赛季，查看战绩、分队阵容、技能、模组、装备、盟约及赛季统计。

试用网站：https://weishu.windoge.top/

## 本地启动

需要 Node.js 22 或以上。

```sh
npm ci
npm start
```

打开 [http://localhost:3000](http://localhost:3000)。若已有进程占用端口，可用 `PORT=3001 npm start`。

## 主机部署

可直接运行 Node.js，也可用项目的 Dockerfile。以下示例把容器端口发布到宿主机本地，由反向代理对外提供 HTTPS。

```sh
docker build -t arknights-stronghold-protocol .
docker run -d --restart unless-stopped --name stronghold \
  -p 127.0.0.1:3000:3000 \
  -e PUBLIC_ORIGIN=https://stronghold.example.com \
  arknights-stronghold-protocol
```

将域名替换为实际地址，反向代理到 `127.0.0.1:3000` 并启用 HTTPS。浏览器使用 Web Crypto 为森空岛请求签名，开发时可用 localhost，其他地址需 HTTPS。反向代理应沿用站点的缓存响应头，扫码路径 `/api/qr/*` 的响应超时设为至少 50 秒。单个进程处理同一张二维码的生成和轮询，服务重启后可重新生成。

| 环境变量 | 用途 |
| --- | --- |
| `HOST` | Node.js 默认监听 `127.0.0.1`，容器默认监听 `0.0.0.0`。 |
| `PORT` | 默认 `3000`。 |
| `PUBLIC_ORIGIN` | 对外站点的完整源，如 `https://stronghold.example.com`，供扫码接口校验同源请求。 |
| `ASSET_BASE_URL` | 可选的 HTTPS OSS 图片目录，如 `https://static.example.com/stronghold/`。将 `public/assets` 里的图片按原名上传到该目录。页面、脚本、样式和扫码 API 仍由主机提供。 |
| `SKLAND_DEVICE_ID` | 可选，覆盖扫码凭证兑换时的服务端设备标识。默认沿用插件的服务端设备标识生成逻辑。 |

## 分享战绩

绑定后，在战绩列表、对局详情或赛季统计点击「导出图片」，浏览器会下载当前页、当前对局或当前赛季的 PNG。导出直接渲染当前页面的组件及样式，保留头像、玩家信息、盟约层数和页面中显示的战绩内容。图片生成在浏览器内完成，公开图片素材通过本站同源转发以便嵌入 PNG。

## 数据与统计

- 浏览器将 Cred、所选角色与赛季保存在本站的 `localStorage`，签名用的短期 token 和对局详情存于当前页面内存。Cred 绑定、角色查询和战绩查询由浏览器直连森空岛。
- 扫码接口临时与鹰角通行证和森空岛交换授权，使用 HTTPS 上游、短期签名票据和 `no-store` 响应。服务端应用不写入凭证、账号或战绩，无数据库，也无第三方页面脚本。部署时保持反向代理对扫码响应禁用缓存。
- 赛季统计及其 PNG 显示常用策略与盟约、普通和隐秘 Boss 击杀、累计与平均耗时，以及各项指标的有效对局数。对局详情也会显示本局 Boss 击杀和耗时。
- 统计按角色 UID 和赛季累计。v2 保存轻量逐局指标和版本匹配的展示资料，旧 v1 汇总保留原键并迁入基线。首次同步只收录接口当前仍能返回的记录，已收录数据滑出窗口后继续累计。旧对局再次返回时会补齐可用指标。
- 解除绑定时可同时清除此账号的两个版本的统计。浏览器缺少 Web Locks 或无法写入站点存储时，本次新增统计在当前页面可见。

## 来源与验证

`npm test` 验证森空岛签名、Token 重试、历史版本资源匹配、赛季累计和扫码票据流程。战绩映射、签名协议与扫码设备标识逻辑源自[方舟插件](https://github.com/gxy12345/arknights-plugin)。干员阶级素材来源见 [素材说明](public/assets/README.md)。游戏素材版权归原权利人所有。
