# 软件设计师模拟考试 · Android APP 开发文档

> 版本：v1.0
> 目标：把 Web 版全部功能迁移为原生 Android APP，完全离线可用，产物为 `software-exam-release.apk`（64 位、<100MB）。
> 技术：**Kotlin + 原生 View + SQLite**（不依赖任何第三方 UI/网络库）。
> 文档维护：开发中的问题记录在 第 11 章。

---

## 1. 目标与范围

| 编号 | 目标 | 验收标准 |
| --- | --- | --- |
| A1 | 功能与 Web 版一致 | 首页、三种模拟考试、真题模考、练习模式、成绩页、历史记录、重做试卷全部可用 |
| A2 | 完全离线 | 无 INTERNET 权限；题库、考试记录、练习进度全部存本地 SQLite |
| A3 | Kotlin 实现 | 全部业务代码 Kotlin，无 WebView 外壳 |
| A4 | 64 位、体积 <100MB | 无 native so，天然支持 arm64-v8a；APK < 100MB |
| A5 | 自测 | 核心逻辑 JVM 单元测试 + 构建产物静态校验 + 题库完整性校验，输出自测文档 |

非目标：多用户、云同步、在线更新题库、平板专用布局（手机竖屏优先，横向自适应）。

---

## 2. Web → APP 功能映射

| 功能 | Web 实现 | APP 实现 |
| --- | --- | --- |
| 首页 | 统计、模式卡片、练习卡片、真题列表、最近考试 | 同布局的纵向滚动页 |
| 上午卷 | 75 单选 / 150 分钟 / 75 分 | 同规则，按模块权重抽题 |
| 下午卷 | 5 主观 / 150 分钟 / 75 分 | 同规则，含 C++/Java 随机 |
| 综合训练卷 | 40+15+15+15 / 120 分钟 / 100 分 | 同规则 |
| 真题模考 | 整卷 75 题（2022 下） | 同，题库随 APK 内置 |
| 倒计时 | 服务端权威计时，到点强制交卷 | 本地计时，基于 `startedAt + duration`，Activity 恢复时校验 |
| 答题卡 | 已答/未答/当前/标记 | 底部抽屉 + 题号网格 |
| 未答拦截 | 交卷前校验 | 同，弹窗列出未答题号 |
| 自动评分 | 单选/判断 1 分，多选全对，填空按空 | 同算法 |
| 主观题 | 参考答案 + 评分要点 + 自评 | 同 |
| 历史记录 | 列表 + 查看 + 删除 | 同，另加「重做」 |
| 重做试卷 | 复制原题原顺序 | 同 |
| 练习模式 | 基础知识 / 应用技术，答案揭示，整库循环 | 同，进度存 settings 表 |

---

## 3. 技术选型

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 语言 | Kotlin 1.9.x | 需求指定；与 Java 互操作 |
| UI | 原生 View（代码构建布局） | 零第三方依赖、包体小、启动快 |
| 数据库 | Android 内置 SQLite（`SQLiteDatabase`） | 无需 Room/Gradle 依赖 |
| 题库 | 预置 `questions.db` 资产，首次启动复制到内部存储 | 与 Web 共用同一份数据，零转换 |
| 构建 | AGP 8.2 + Gradle 8.7 + JDK 17 | 兼容 SDK 34 |
| 测试 | JUnit4 + Robolectric 4.11 | 无模拟器时在 JVM 启动真实 Activity |
| minSdk / targetSdk | 24 / 34 | 覆盖 Android 7.0+ |

---

## 4. 架构

```
MainActivity（单 Activity，屏幕栈式切换）
 ├─ HomeScreen     首页
 ├─ ExamScreen     考试（倒计时 / 答题卡 / 交卷）
 ├─ ResultScreen   成绩（解析 / 主观题自评 / 重做）
 ├─ PracticeScreen 练习（答案揭示 / 循环抽题）
 └─ HistoryScreen  历史记录

core（不依赖 Android，可 JVM 单测）
 ├─ Types.kt        题目/试卷/考试数据类、模块常量
 ├─ Grade.kt        归一化、客观题判分
 ├─ Paper.kt        组卷权重、抽样、打乱、真题卷、重做
 └─ Practice.kt     练习池与循环游标

data（Android SQLite）
 ├─ Db.kt           打开/复制资产库、DAO
 └─ Repo.kt         业务仓储：考试创建、作答保存、交卷、自评、历史
```

---

## 5. 数据库设计

直接复用 Web 版 schema（`data/questions.db`）：

- `questions(id, ext_id, type, topic, knowledge, difficulty, stem, options, answer, rubric, explanation, score, paper, paper_title, source, seq_no)`
- `exams(...)`、`exam_questions(...)`、`settings(k,v)`

处理方式：
1. 导出前对 Web 库执行 `PRAGMA wal_checkpoint(TRUNCATE)` 并将 `journal_mode` 设为 `DELETE`，保证单文件可直接拷贝；
2. APK 内 `assets/questions.db`；
3. 首次启动复制到 `filesDir/questions.db`（约 2MB）；
4. 题库校验：启动时检查 `questions` 行数，异常时提示。

---

## 6. 业务规则（与 Web 一致）

### 6.1 组卷

- 上午卷权重：DS_ALGO 17、SE 14、OO 11、DB 10、OS 8、NET 6、PL 5、CO 2、SEC 1、MULTI 1（合计 75）。
- 抽样：按难度分层（易 35% / 中 45% / 难 20%），不足时补齐；模块间去重；打乱后修复「连续 3 题同模块」。
- 综合卷：单选 40×1 + 多选 15×2 + 填空 15×1 + 判断 15×1。
- 下午卷：数据流图 / 数据库设计 / UML 建模 / 算法设计 / 程序设计（C++ 或 Java 随机）。
- 真题卷：按 `paper` 取 75 题，按 `seq_no` 排序。

### 6.2 评分

- 单选、判断：完全一致得满分。
- 多选：**全对得分，少选/多选/错选不得分**。
- 填空：按空给分，答案支持 `|` 分隔同义写法；归一化：去空白、全角转半角、小写。
- 主观题：不自动评分，交卷后展示参考答案与评分要点，用户 0–15 自评。

### 6.3 考试规则

- 倒计时结束强制交卷（`autoSubmitted`）。
- 存在未答题时禁止交卷，弹窗列出题号。
- 同一时间只允许一场进行中的考试；新开考试需先交卷/放弃。
- 刷新/退出后重新进入可继续作答（数据在 SQLite）。

### 6.4 练习规则

- 基础知识池：single/multi/fill/tf（1945 题）；应用技术池：subjective（210 题）。
- 每个模式保存一份洗牌顺序；客户端 `pos` 游标前进，一轮取完重新洗牌，**同一轮不重复**。
- 点「下一题」→ 显示答案与解析；再点 → 下一题。

---

## 7. 界面设计（移动端）

- 深蓝主色 `#16324F`，主色 `#1F5FA8`，卡片白底圆角 12dp，阴影轻。
- 统一字号：标题 20sp、题干 16sp、选项 15sp、辅助 12–13sp。
- 首页：统计胶囊、继续考试横幅、考试模式卡片（2 列网格）、练习模式卡片、真题列表、最近考试。
- 考试页：顶部固定栏（标题 / 倒计时 / 已答进度 / 交卷），题干卡片，选项卡片，底部上一题 / 标记 / 下一题；「答题卡」悬浮按钮打开底部抽屉。
- 答案卡：7 列题号网格，已答蓝底、当前描边、标记橙点。
- 成绩页：分数卡片 + 合格徽章 + 逐题解析 + 主观题参考答案与评分输入 + 重做按钮。
- 历史页：列表项（标题 / 时间 / 得分 / 查看 / 重做 / 删除）。
- 练习页：顶部进度，题干卡片，作答区，「下一题」按钮；揭示后显示答案解析区块。

---

## 8. 构建环境（不写入默认环境变量）

工具链统一放在 `/app/workspace/toolchain/`：

```
toolchain/
├── jdk/                  # Temurin JDK 17
├── sdk/                  # ANDROID_HOME（cmdline-tools、platform-tools、platforms/android-34、build-tools/34.0.0）
└── gradle-8.7/           # Gradle 发行版（通过 gradle-wrapper 或直接调用）
```

**无需修改 ~/.bashrc / /etc/profile**。编译时在脚本内临时导出：

```bash
export JAVA_HOME=/app/workspace/toolchain/jdk
export ANDROID_HOME=/app/workspace/toolchain/sdk
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

### 8.1 首次安装步骤

```bash
# JDK 17
curl -L -o jdk17.tar.gz "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
tar xzf jdk17.tar.gz && mv jdk-17* jdk

# Android cmdline-tools
curl -L -o cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q cmdline-tools.zip -d sdk/cmdline-tools-tmp
mv sdk/cmdline-tools-tmp/cmdline-tools sdk/cmdline-tools   # 目录结构需为 sdk/cmdline-tools/latest
# 安装组件
yes | sdkmanager --sdk_root=$ANDROID_HOME --licenses
sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# Gradle 8.7
curl -L -o gradle.zip https://services.gradle.org/distributions/gradle-8.7-bin.zip
unzip -q gradle.zip
```

### 8.2 签名

- 生成专用 keystore：`keytool -genkeypair -keystore android.keystore -alias softexam -keyalg RSA -keysize 2048 -validity 10000 -storepass softexam123 -keypass softexam123 -dname "CN=SoftExam, OU=Study, O=Personal, L=CN, ST=CN, C=CN"`
- `app/build.gradle.kts` 配置 release signingConfig 读取该 keystore（仅用于个人使用，正式发布应替换并妥善保管）。

### 8.3 构建命令

```bash
cd android
./build.sh          # 内部 export 环境变量后执行 gradle assembleRelease
```

产物：`android/app/build/outputs/apk/release/app-release.apk`，复制为 `software-exam-release.apk`。

---

## 9. 自测方案

| 层级 | 内容 | 方式 |
| --- | --- | --- |
| 单元测试 | 归一化、单选/多选/判断/填空判分、主观题不判分 | JVM 单元测试（JUnit） |
| 组卷测试 | 上午卷 75 题与权重、连续 3 题不同模块、综合卷满分 100、下午卷 5 题 15 分 | JVM 单元测试（内存假题库） |
| 练习测试 | 一轮不重复、循环后重开 | JVM 单元测试 |
| 数据校验 | APK 内 questions.db 行数、题型分布、真题 75 题、答案非空 | 宿主机脚本 + SQLite 查询 |
| 构建产物 | APK 可安装、签名有效、包名/版本、无 INTERNET 权限、体积、64 位 | `apksigner verify`、`aapt2 dump badging`、`unzip -l` |
| 运行验证 | 启动、首页渲染、抽题、做题、交卷、评分、练习、历史 | 模拟器不可用（环境无 KVM），改为核心逻辑单测 + 产物静态校验，并在文档中记录该限制 |

---

## 9.1 实际构建与自测结果

- 构建命令：`cd android && ./build.sh assembleRelease`，**BUILD SUCCESSFUL**。
- 产物：`software-exam-release.apk`，**1.29 MB**，已签名（SHA-256 `4b28f6de…`）。
- 包名 `com.softexam`，minSdk 24 / targetSdk 34，**无任何权限**（完全离线），**无 native so**（64 位设备可直接运行）。
- 自动化测试：`./build.sh testReleaseUnitTest` → **17 个用例全部通过**（核心逻辑 14 + Robolectric 真实 Activity 冒烟 3）。
- Robolectric 覆盖：Activity 启动、首页渲染、组卷、进入考试页、逐题作答、交卷评分、成绩页重做按钮、练习页、历史页、内置题库读取。
- 环境限制：无 KVM，未运行 Android 模拟器；真机手工测试清单见 `tests/APP自测报告.md`。

## 10. 风险

| 风险 | 应对 |
| --- | --- |
| 无 KVM，无法跑模拟器 | 核心逻辑 JVM 单测；UI 代码保持薄；提供手工测试清单 |
| SDK 下载体积大、构建慢 | 只装必要组件（platform 34、build-tools 34），Gradle 依赖仅 AGP + Kotlin 插件 |
| APK 体积 | 无第三方 UI 库、无 native so，预计 5–10MB |
| 数据文件与 Web 不一致 | 同 schema、同导出流程，启动时校验行数 |

---

## 11. 问题记录

| 编号 | 阶段 | 问题 | 根因 | 解决 |
| --- | --- | --- | --- | --- |
| P1 | 环境 | `/opt` 不可写 | 容器以非 root 运行 | 工具链放到 `/app/workspace/toolchain` |
| P2 | 环境 | 无 KVM，模拟器不可用 | 容器未暴露 /dev/kvm | 采用 JVM 单测 + 产物静态校验，UI 层保持薄 |
| P3 | 环境 | 容器内无 `unzip` | 精简镜像 | 使用 Node `unzipper` 解压 SDK/Gradle 包 |
| P4 | 环境 | 解压后脚本无执行权限 | unzipper 不保留权限位 | `chmod +x` 处理 sdkmanager / gradle |
| P5 | 编译 | `GradientDrawable.setStroke` 需 Int 宽度 | Kotlin 类型严格 | 改为 `strokeWidth.toInt()` |
| P6 | 兼容 | `settings` 表 UPSERT 需 SQLite 3.24+（Android 9+） | minSdk 24 的 SQLite 不支持 | 改为 `INSERT OR REPLACE` |
| P7 | 运行时 | 考试页初始化顺序错误 | `progressText` 未赋值先调用 | 调整 build 内赋值顺序 |
| P8 | 运行时 | 标签控件被重复 addView | 闭包内 addView 与外部 addView 重复 | 改为设置 `layoutParams`；由 Robolectric 冒烟测试发现 |
