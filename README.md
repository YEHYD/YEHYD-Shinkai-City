# Shinkai City

一个零构建的 three.js 都市漫游 demo：新海诚风格的黄昏城市，第三人称主角，
街上十五个可交谈的角色，**每次对话都会沿着人物关系网悄悄改变其他人**。

## 运行

```bash
node tools/serve.mjs --port 8150
# 打开 http://127.0.0.1:8150/
```

没有构建步骤，没有 npm 依赖。three.js r187 放在 `vendor/three/`，通过 `index.html`
里的 importmap 解析（`three` 与 `three/addons/`）。必须走 HTTP —— `file://` 下
ES module 与 `fetch` 都会被 CORS 拦掉。

## 单文件演示版（拷去别的设备用）

```bash
node tools/build-single.mjs      # 产出 dist/index.html（约 4 MB）
```

`dist/index.html` 是**双击就能跑**的一个文件：所有模块（含 three.js）被 esbuild 打成
一个内联 `<script type="module">`，48 张角色立绘转成 base64 `data:` URL 一起塞进去，
importmap 被去掉。页面在 `file://` 下不发起任何网络请求，所以没有 CORS 问题。

- 构建需要 esbuild 二进制（不是 npm 依赖）：放在 `tools/esbuild.exe`，或用
  `ESBUILD=/path/to/esbuild` 指定。它只在打包时用，不用带进演示设备。
- `file://` 下唯一的硬要求是浏览器支持 WebGL2 与内联 module（Chrome / Edge /
  Firefox / Safari 现代版本均可）。
- 演示设备什么都不用装：拷这一个文件过去，双击。
- 同目录还有 `start-demo.bat`（自动找 Chrome/Edge 并用 `--allow-file-access-from-files`
  打开，免得某些版本的本地文件读取被卡）与 `README.txt`（现场给人看的操作说明）。
- 卡的话在地址后面加 `?quality=lite`：行人与车辆降到 210 / 110 辆。
- 单文件版里有两处只有 `file://` 才会暴露的坑，已修：对话立绘必须走
  `spriteSrc()` 取 data: URL（否则 404）、夜空云层亮度不能只按 `night` 保留 0.26 白
  （否则整片天被洗成暖灰）。

## 部署到 GitHub Pages（发个链接给别人看）

单文件版没有外部依赖，所以 GitHub Pages 只需要托管一个静态文件。已实测：把
`dist/index.html` 放到子路径（`https://<user>.github.io/<repo>/`）下打开，
`performance.getEntriesByType('resource')` 返回 **0 条请求**、72 fps、128 draw call、
行人 520 / 车辆 260 全在，console 只有一行 `[shinkai] ready`。

两条路，任选：

**A. 不要 Actions（最省事）** —— 适合只要一个能点的链接：

```bash
node tools/build-single.mjs
cp dist/index.html index.html     # 放到仓库根
touch .nojekyll                   # 别让 Jekyll 处理它
git add index.html .nojekyll && git commit -m "deploy demo" && git push
```

然后 Settings → Pages → Source: **Deploy from a branch** → `main` / `(root)`。

**B. 用仓库里现成的 workflow** —— 保留源码树，`dist/` 由 CI 重新构建，不会出现
「源码改了、线上还是旧包」：

- 仓库已带 `.github/workflows/pages.yml`（`npm i esbuild` → `node tools/build-single.mjs`
  → 上传 `dist` → 部署）。
- Settings → Pages → Source: **GitHub Actions**，之后 push `main` 就自动发布。
- workflow 里 `ESBUILD=./node_modules/.bin/esbuild` 是必须的：`tools/esbuild.exe`
  是 Windows 二进制，Linux runner 上跑不了。

几个注意点：

- 免费账号的 Pages **只能发布公开仓库**；私有仓库要 Pro 及以上。
- `dist/` 里另有 `README.txt`、`start-demo.bat`、`.nojekyll`，一起发上去无害；
  `.bat` 只在 Windows 本地双击时有用。
- 首屏要下 4.19 MB（three.js 826 KB + 立绘 3358 KB 都内联在里面），移动网络慢的话
  第一次打开会等一会儿；之后走 CDN 缓存。
- 页面不发任何网络请求，所以不存在 CORS、混合内容、Service Worker 之类的坑；
  换 `?quality=lite` 也照常生效（它只是运行时降低行人/车辆数量，不影响下载体积）。

## 操作

| 键 | 作用 |
| --- | --- |
| `W A S D` / 方向键 | 移动（相对镜头方向） |
| `Shift` | 跑 |
| 拖动鼠标 | 环视（镜头会被建筑推开，不会穿墙） |
| 滚轮 | 拉近 / 拉远 |
| `E` | 靠近角色时交谈；对话中快进打字；说完再按一次结束 |
| `1` `2` `3` | 选择对话选项 |
| `Esc` | 结束对话 / 关地图 |
| `V` | 切换城市俯瞰（起重机镜头，会抬到屋顶之上） |
| `M` | 打开城市地图：点任意位置传送，点角色直接落到他面前 |
| `[` `]` | 拨动时间（每次 20 分钟），用来观察光的变化 |

## 街上有多少人

* **520 个行人**（`lite` 质量 210）——沿两侧人行道分两条子车道走，约五分之一站着
  看橱窗；用 `InstancedMesh` 按「立绘 × 视角」分批，整群只占十来个 draw call。
* **260 辆车**（`lite` 110）——左侧通行，四个 `InstancedMesh`（车身 / 车厢 / 前灯 / 尾灯），
  前灯尾灯用叠加混合，亮度随夜色升起。
* **沿街店铺**：约 430 个临街面按 3.8–5.4 m 切成单元，每间有玻璃、雨棚、招牌、
  地面光池；另有竖霓虹、售货机、电线杆与电线、路口信号灯、广场长椅。
* 行人与车辆都走**分层抽样的车道槽位**，不是纯随机撒点——随机撒会让整条街空掉，
  只剩某个角落挤三个人。

## 街上的人：十五个可交谈的角色

八个是原来的居民（铃 女仆 / 蓝 计程车 / 青 执扇 / 墨 书虫 / 月 月见 / 白 白服 / 绯 绯衣 /
汐 人鱼），另外七个来自 `素材/` 里的三视图，按调色板取名，都接在同一张关系网上：

| 名字 | 身份 | 站在 | 开场白 |
|---|---|---|---|
| 荷 | 花匠 | (7.8, 66) | 「这些花是替你养的。你不知道吧。」 |
| 砚 | 书商 | (-7.8, 70) | 「第三层有一本没有名字的书。别翻。」 |
| 澪 | 摆渡 | (-7.8, -34) | 「水退下去的时候，这条路会变成河。」 |
| 雪 | 信使 | (7.8, -66) | 「有你的信。寄信的人没写名字。」 |
| 灼 | 铁匠 | (-66, 7.8) | 「铁冷下来的时候会响。你听见了吗。」 |
| 霞 | 暗房 | (66, -7.8) | 「这个时间的颜色，我留不住，只能记着。」 |
| 珀 | 调酒 | (-7.8, 88) | 「杯子我先温过了。坐吧。」 |

原始三视图在 `素材/`（约 8.8 MB，和 `characters-src/` 一样不进 git），仓库里只放
切好的 WebP。

`src/actors/roster.js` 里的 `links` **是单向的**：传言只沿写下来的那条边走，
所以想让两个人互相念叨，两边的边都要写。

## 再加一个角色（从一张三视图开始）

1. 把「一张图 = 一个角色，左→右 正/侧/背」的白底图丢进 `素材/`；
2. 在 `tools/import-character-sheet.py` 的 `SHEETS` 里加一行 `文件名前缀: 角色 id`，
   然后 `python tools/import-character-sheet.py`（只依赖 Pillow）——它从四边种子做
   scanline flood fill 抠白底（`TOL=26` + 0.7 羽化，白衣服不会被挖穿），按列带切成
   三视图，压到高 720 的 WebP，并**合并**进 `assets/characters/manifest.json`；
3. 在 `src/actors/roster.js` 加一条：`id / name / role / line / accent / x / z / yaw /
   height / mood`，再补几条 `links`。

## 对话如何影响别人

`src/story/social.js` 是这套玩法的内核，模型很小但可读：

* 每个居民持有 `mood`（−1..1）、对主角的 `trust`（0..1）和一串**记忆**（传言）；
* 和某人说话，会在他身上种下一条传言，权重由语气强度决定（温和 = 1.0，冷淡 = −1.0）；
* 每隔 1.15 秒，传言沿人物关系边扩散一次，权重按关系类型打折
  （兄妹 0.86、朋友 0.78、旧识 0.70、常客 0.62、对手 0.55、泛泛 0.46、陌生 0.28），
  并且越走越淡、越走越难再传；
* 情绪也沿关系边互相拉扯，所以和一个人聊得开心，他身边的人也会慢慢放松；
* 信任会缓慢回落到中性基线，一次好话不会让人一辈子对你笑脸。

游戏里能直接看到的结果：对铃温柔地说一句天空，几秒后走到蓝面前，她会说
「铃说你是个不难说话的人。」——反过来，对汐冷淡，青和白就会用
「汐说你问话的样子像在查户口。」开门。左下角会滚出传言传递的路径。

## 目录

```
index.html              单页入口：importmap + HUD/DOM 样式
src/main.js             装配与主循环
src/core/               输入、循环、随机数、程序化纹理（含店铺/招牌/霓虹/售货机图集）
src/scene/              大气（太阳/月亮/雾/曝光）、天空球、灯光、后处理
src/world/              街区布局生成、合批城市几何、沿街店铺门面
src/actors/             第三人称主角、billboard 精灵、角色花名册、行人、车流
src/camera/             第三人称相机（含建筑遮挡拉近、城市俯瞰）
src/story/              社交内核 + 对话编排
src/ui/                 HUD、对话面板、传送地图
assets/characters/      已抠图并压缩的角色三视图（WebP，16 个角色 × 3 视角）
tools/serve.mjs         零依赖静态服务器（no-store，改代码刷新即生效）
tools/build-single.mjs  打成双击可运行的 dist/index.html
tools/import-character-sheet.py  三视图素材 → 抠图/切分/WebP → manifest
vendor/three/           three r187 + 用到的 addons
```

## 实现要点

* **天空与雾用同一组颜色**。`src/scene/sky.js` 是自己写的天空球，不是 addons 的
  `Sky`——因为地平线色必须和 `Fog` 完全一致，远景才会融进天里。
* **城市是合批的**。四种立面纹理 × 四个 Mesh，加上屋顶、路灯、远景天际线，
  整座城约 12 个 draw call；立面 UV 按 `TILE_W = 18m / TILE_H = 21.6m` 逐面缩放，
  窗格尺寸在任意楼高下都不变形。
* **角色是二维立绘**。按镜头方向在 front / side / back 之间切换（带滞回，避免抖动），
  只绕 Y 轴朝向相机；不受灯光，由大气状态统一染色，所以黄昏是暖的、夜里是冷。
* **云画在天空穹里，不是贴在天上的平面**。街区视角能看到的天空只是一条低仰角的窄缝，
  700 m 高的云盘根本进不了画——所以地平线云带直接做进天空球的 fragment shader，
  按方向采样一张 alpha 云图，太阳光晕与云互相遮挡。高空那几层云盘仍然保留，
  用于俯瞰和抬头（`V`）。
* **夜景的过曝是被压下去的，不是调暗的**。bloom `strength 0.24 + 0.34·night`、
  `threshold 0.78`，墙窗 emissive `0.05 + 1.55·night^1.35`，灯头 `0.22 + 2.3·night`；
  实测过曝像素（>246）从 0.30% 降到 0.00%。街面亮度靠半球光补——黄昏的
  `hemiI` 从 0.95 提到 1.42，否则 18:00 的街道会黑成一条沟。
* **街面还有一盏「城市反弹光」**。黄昏太阳仰角只有 ~14°，直射项打在水平路面上
  几乎为零（关掉阴影图路面亮度只升 0.2），近处沥青会塌成纯黑。所以加了
  一盏暖色 `AmbientLight`（`0.16 + 0.46·warm + 0.20·night`）冒充整条街的
  立面反光：近处路面亮度 19 → 82，整幅均值 68.6 → 81.4，过曝仍是 0%。
* **灯光跟的是「暖」，不只是「夜」**。橱窗、招牌、售货机、路灯、塔楼窗格都写成
  `…·night + …·warm`：只按 `night` 算的话，18:03 的 `night` 才 0.1，整条街的店
  和灯都不亮，黄昏看起来像停电。加暖项后日落时店先亮、灯先燃，入夜再由 `night` 接管。
* **除了立绘，没有外部图片资产**。立面、地面、云、招牌、光晕全部在 canvas 上程序化生成；
  唯一的外部图是 `assets/characters/` 里的角色三视图。

## 已知取舍

* 对话是模板拼装而非模型生成：结构（我是谁 / 我对你的情绪 / 我从谁那里听说了什么）
  已经和接一个 LLM 时该传的上下文一致，替换 `src/story/dialogue.js` 的文本层即可。
* 建筑材质还是偏平（缺 AO / 法线细节 / 体积光），下一步可加 GTAO 与高度雾。
* 许可与归属见 [CREDITS.md](./CREDITS.md)。