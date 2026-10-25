# 软件设计师模考 · Android APP 自测报告

> 日期：2026-10-22
> 产物：`software-exam-release.apk`（1.29 MB，已签名）
> 结论：**构建成功；17 个自动化测试用例全部通过；APK 静态校验全部通过；题库完整性校验通过。**
> 说明：本环境无 KVM，无法运行 Android 模拟器；改用 **Robolectric 在 JVM 中启动真实 Activity** 完成运行时冒烟测试（见第 3 节）。

---

## 1. 构建环境

| 组件 | 版本 / 位置 |
| --- | --- |
| JDK | Temurin 17.0.20.1（`/app/workspace/toolchain/jdk`） |
| Android SDK | platform-tools + platforms;android-34 + build-tools;34.0.0（`/app/workspace/toolchain/sdk`） |
| Gradle | 8.7（`/app/workspace/toolchain/gradle-8.7`） |
| AGP / Kotlin | 8.2.2 / 1.9.22 |
| 环境变量 | **仅在 `android/build.sh` 内临时 export**，未写入任何全局配置 |
| 签名 | `android/android.keystore`（alias `softexam`，RSA 2048，有效期 10000 天） |

构建命令：

```bash
cd android
./build.sh assembleRelease
```

---

## 2. JVM 单元测试（核心逻辑）

`./build.sh testReleaseUnitTest` → **14 个用例全部通过**（`CoreTest`）：

| 用例 | 内容 |
| --- | --- |
| normalizeHandlesFullWidthAndSpaces | 全角/空格/大小写归一化 |
| singleChoice | 单选对/错判分与得分 |
| multiChoiceAllOrNothing | 多选全对得分、少选/多选/错选 0 分 |
| trueFalseVariants | 判断「对/错/正确/错误」归一 |
| fillPartialCredit | 填空多空按空给分（2 空答对 1 空得一半） |
| subjectiveNotAutoGraded | 主观题不自动判分 |
| passLines | 上午/下午 45 分、综合卷 60% 合格线 |
| miniJsonRoundTrip | 作答 JSON 编解码（引号/换行/反斜杠） |
| practiceShuffleKeepsAllIds | 练习洗牌不丢题、不重复 |
| morningPaperWeights | 上午卷 75 题，10 个模块题量=真题权重，无连续 3 题同模块 |
| mixedPaperScore100 | 综合卷 85 题、满分 100 |
| afternoonPaperFiveQuestions | 下午卷 5 题、每题 15 分、题型不重复 |
| realPaper75 | 真题卷 75 题且不重复 |
| unansweredDetection | 未作答判定 |

---

## 3. Robolectric 运行时冒烟测试（真实 Activity）

`AppSmokeTest`（Robolectric 4.11.1，SDK 33）→ **3 个用例全部通过**：

| 用例 | 验证内容 |
| --- | --- |
| launchHomeAndStartExam | 启动 MainActivity；首页显示标题；创建上午卷并进入考试页（显示交卷、第 1 题）；逐题作答并交卷；成绩页显示总分与「重做这套试卷」 |
| practiceRevealsAnswer | 进入基础知识练习，显示「本轮 / 共 N 题」与「下一题」 |
| historyAndMeta | 题库总量 ≥ 2000、2022 下真题 75 题；进入历史记录页正常渲染 |

> 该测试真实打开随 APK 打包的 `questions.db`（复制到沙箱内部存储），验证了题库资产、SQLite 访问、组卷、保存作答、交卷评分、页面导航等完整链路。

---

## 4. APK 静态校验

| 检查项 | 结果 |
| --- | --- |
| 包名 / 版本 | `com.softexam` / versionCode 1 / versionName 1.0 |
| minSdk / targetSdk | 24 / 34（Android 7.0+） |
| 签名 | `apksigner verify` 通过，证书 CN=SoftExam（SHA-256: 903c17f4…） |
| 体积 | **1,293,749 字节（1.29 MB）**，远小于 100MB 上限 |
| 权限 | **无任何权限**（未申请 INTERNET，完全离线） |
| native 库 | **无 `lib/` 目录、无 .so** → 与 ABI 无关，64 位设备（arm64-v8a）可直接安装运行 |
| 启动 Activity | `com.softexam.MainActivity`（exported） |
| 内置题库 | `assets/questions.db` 2,019,328 字节 |
| 题库内容 | 2155 题（单选 1051 / 多选 196 / 填空 352 / 判断 346 / 主观 210），2022 下真题 75 题，考试记录 0 条 |
| SHA-256（前 32 位） | `4b28f6de4094fb75a400ef901e655e0e…` |

---

## 5. 自测中发现并修复的问题

| 编号 | 问题 | 现象 | 修复 |
| --- | --- | --- | --- |
| P3 | 容器内无 `unzip` | 解压 SDK/Gradle 失败 | 用 Node `unzipper` 解压 |
| P4 | 解压后脚本无执行权限 | `sdkmanager` / `gradle` 报 Permission denied | `chmod +x` |
| P5 | `GradientDrawable.setStroke` 参数类型错误 | Kotlin 编译失败 | 宽度改为 Int |
| P6 | SQLite `ON CONFLICT ... DO UPDATE` 需 API 24+ 不支持 | Android 7/8 上会崩溃 | 改为 `INSERT OR REPLACE` |
| P7 | 考试页 `progressText` 未初始化就调用 | 进入考试页崩溃 | 调整初始化顺序 |
| P8 | 标签控件被 `addView` 两次 | `IllegalStateException: child already has a parent`（Robolectric 发现） | 改为设置 layoutParams |

---

## 6. 未覆盖项与手工测试清单

受环境限制（无 KVM、无 Android 设备），以下需在真机补测：

- [ ] 安装 APK 并首次启动（题库解压耗时约 1 秒）
- [ ] 上午卷倒计时显示、到点自动交卷
- [ ] 手机旋转/切后台后返回，剩余时间与进度正确
- [ ] 答题卡抽屉、跳题、标记
- [ ] 未答完点击交卷的拦截弹窗
- [ ] 主观题自评保存后总分刷新
- [ ] 历史记录查看 / 重做 / 删除
- [ ] 练习模式连续做题直至一轮结束（自动进入下一轮）

---

## 7. 产物

| 文件 | 说明 |
| --- | --- |
| `software-exam-release.apk` | 已签名 release APK（1.29MB） |
| `android/` | 完整 Kotlin 工程（可再次构建） |
| `android/build.sh` | 构建脚本（临时 export 环境变量） |
| `android/android.keystore` | 签名文件（密码 `softexam123`，仅个人使用） |
| `docs/APP开发文档.md` | 开发文档 |
| `tests/APP自测报告.md` | 本报告 |
