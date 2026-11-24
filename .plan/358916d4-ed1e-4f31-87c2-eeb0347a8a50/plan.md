# 需求文档

## 1. 改动目标

GitHub Pages 线上一直"没有同步"。本轮通过 GitHub API 远程取证已锁定真实根因：**你本地的 `git push origin main` 从来没有成功过**——GitHub 仓库的 main 分支最新提交还停在 11月23日（沙箱自动推送的那批），本地 bundle 拉取虽然成功，但合并/推送环节始终没完成。需要把同步流程改造成"一条命令、不会失败"的方式，并给出可验证的自查手段。

## 2. 现状分析（远程取证结论）

- `api.github.com/repos/DHB20123309/Doggie/commits/main` → HEAD = `c250074`（"桌面App排与分页指示点上移"，2026-11-23T14:47）。
- 沙箱最新 commit 是 `06e76c6`（索要照片必出真图修复），bundle 内 main 指向它——**两者相差 8 个 commit，全部是 11月24日的更新**。
- Actions 最近一次 "Deploy to GitHub Pages" 运行对应 `c250074`，conclusion=success；Pages 上的 index.html 引用旧构建产物（无禁缓存 meta）。
- 结论：部署流水线本身健康（push 成功就会自动构建发布），问题 100% 卡在"本地 → GitHub"这一步。此前两轮分别修了 bundle 缺 main 引用、git 身份未配置，但截图显示 pull 后仍无 push 成功回执——大概率是 pull 产生了合并冲突或 merge editor 卡住后被放弃，push 实际未执行/未成功。

## 3. 方案

### A. 沙箱侧：导出"快进式"bundle + 一键同步脚本（主方案）
1. 每次导出 bundle 前，用 `git merge-base` 校验沙箱 main 是否包含 GitHub 远端 main 的最新 commit（`c250074` 已在历史中，正常成立），保证用户 pull 是**纯快进（fast-forward）**、不产生合并提交、不会弹编辑器、不会有冲突。
2. 随 bundle 一起交付一个 `sync.bat` 批处理文件（写入 outputs）：内容固定为
   ```
   git -C C:\Users\HP\Desktop\Doggie pull --ff-only C:\Users\HP\Downloads\Doggie.bundle main
   git -C C:\Users\HP\Desktop\Doggie push origin main
   ```
   双击即完成同步；`--ff-only` 若失败会明确报错而不是留下半截状态。
3. 交付总结里附一条自查命令：`git -C C:\Users\HP\Desktop\Doggie log --oneline -1` 应显示 `06e76c6`（或当轮最新哈希）；再用浏览器开 `https://github.com/DHB20123309/Doggie/commits/main` 看最新提交日期是否为今天。

### B. 备选（A 不可行时）：GitHub 直推
若 `--ff-only` 报"not possible/fast-forward"，说明本地 main 有分叉（可能曾手动 commit 过），此时改用：
```
git -C C:\Users\HP\Desktop\Doggie reset --hard 06e76c6...（bundle FETCH_HEAD）
```
或最简路径：在 GitHub 网页上删除本地分叉疑虑前，先执行 `git status` 拍照发我判断。B 方案作为兜底指引写在交付说明里，不预先执行。

### C. 不做的事
- 不改 deploy.yml（流水线已被证明健康）。
- 不再动 bundle 打包方式（main 引用上一轮已修复且本次 pull 回执正常）。

## 4. 涉及文件定位

| 文件 | 改动 |
|---|---|
| `/home/user-files/outputs/sync.bat` | 新增：双击一键 pull+push 脚本 |
| （沙箱 git 操作） | 导出前 merge-base 校验快进可行性 |

## 5. 实现步骤
1. 校验 `git merge-base --is-ancestor c250074 main` 确认快进成立。
2. 写 sync.bat 到 outputs。
3. 重新导出 Doggie.bundle（当前已是最新，仅复核大小与 main 引用）。
4. 交付总结给出：双击 sync.bat → 等 Actions 1-2 分钟 → 手机打开验证；以及自查命令与异常时的 git status 反馈路径。

## 6. 验收标准
1. 双击 sync.bat（或手敲两条命令）后，cmd 输出出现 `Updating c250074..06e76c6 Fast-forward` 与 push 的 `c250074..xxxxx main -> main` 字样。
2. 浏览器打开 `https://github.com/DHB20123309/Doggie/commits/main` 第一条是今天的提交。
3. 约 2 分钟后 `https://dhb20123309.github.io/Doggie/` 源码里能看到禁缓存 meta（Ctrl+U 查看），手机打开即为新版。

## 7. 风险与回归
- 若你本地 Desktop\Doggie 里曾手动改过文件并 commit，`--ff-only` 会拒绝合并并报 explicit error——这正好暴露问题而非静默失败，届时把报错截图发我按 B 方案处理。
- push 需要你的 GitHub 凭证仍然有效（之前能推 c250074 之后的版本说明可用，风险低）。

## 8. 本期不实现
- 不引入 GitHub CLI / 桌面端工具等新依赖。
- 不为 Pages 配置自定义域名或 CDN 主动清缓存（平台不提供）。