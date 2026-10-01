# GUI 程序逆向 (GUI Reversing)

## 概述

GUI（图形用户界面）程序逆向是指针对使用图形界面框架（MFC、Qt、WinForms、WPF、GTK+ 等）开发的应用程序进行逆向分析。GUI 程序的逆向与控制台程序有显著不同——程序的逻辑分散在大量的消息响应函数、事件处理器、状态回调中，代码路径的触发依赖于用户交互。

在 CTF 逆向中，GUI 程序通常包含复杂的交互逻辑（注册验证、对话框序列、图形界面加密等），需要逆向工程师理解 GUI 框架的结构和运行机制。

---

## 常见 GUI 框架逆向

### 1. MFC (Microsoft Foundation Classes) 逆向
MFC 是微软提供的 C++ Windows GUI 框架，封装了 Win32 API。在逆向中 MFC 程序有其独特的识别特征和分析方法。

**识别特征**:
- 链接了 MFC 库（静态链接或动态链接 MFC DLL，如 `mfc140u.dll`）。
- 消息映射表（Message Map）: MFC 将 Windows 消息映射到类成员函数的核心机制。
- `CCmdTarget` 派生的虚函数表结构。
- `AfxWndProc` / `AfxWindowProc` 作为全局窗口消息分发器。

**消息映射表结构**:
```cpp
struct AFX_MSGMAP_ENTRY {
    UINT nMessage;        // Windows 消息 ID（如 WM_COMMAND=0x111）
    UINT nCode;           // 控制码或通知码
    UINT nID;             // 控件 ID
    UINT nLastID;         // 最后一个控件 ID（处理范围）
    UINT nSig;            // 函数签名（参数类型编码）
    AFX_PMSG pfn;         // 处理函数指针
};
```

**关键逆向方法**:
- 在 IDA 中定位 `AFX_MSGMAP` 结构，遍历消息映射表获取所有消息处理函数。
- 关注 `WM_COMMAND`（菜单/按钮点击）和 `WM_LBUTTONDOWN`（鼠标点击）等用户交互消息。
- 控件 ID（`nID`）通常对应资源文件中定义的 ID。使用 Resource Hacker 查看对话框/菜单资源。
- **Dialog Data Exchange (DDX)**: MFC 的控件与变量绑定机制，在 `DoDataExchange` 函数中定义。
- **消息反射**: MFC 支持控件向父窗口反射消息，处理函数在控件类中定义。

**MFC 常见模式**:
- 注册码验证: 通常在 `OnOK()` 或 `OnBnClickedOk()` 中处理。
- 对话框流程: 通过 `DoModal()` 启动模态对话框，处理完成后返回 `IDOK`/`IDCANCEL`。

### 2. Qt 逆向
Qt 是跨平台的 C++ GUI 框架，广泛应用于开源软件、嵌入式系统和商业程序。

**识别特征**:
- Qt 元对象系统: 链接了 `QtCore`、`QtGui`、`QtWidgets` 等模块。
- 元对象信息: `QMetaObject` 结构包含类名、信号/槽列表、属性等。
- 信号槽（Signal/Slot）机制是 Qt 程序的核心事件驱动方式。
- `Q_OBJECT` 宏生成的元对象代码（通常以字符串形式包含类名）。

**关键逆向方法**:
- 在二进制中搜索 `QMetaObject` 相关的字符串（`"QWidget"`、`"QPushButton"` 等）。
- IDA 插件（如 `qt_idb.py`）自动解析并重命名 Qt 的信号槽函数。
- **信号与槽连接**: `connect(sender, SIGNAL(...), receiver, SLOT(...))`。
  - 在逆向中表现为 `QMetaObject::connect` 调用，包含信号/槽签名字符串。
  - 签名字符串包含参数类型（如 `"clicked()"`、`"clicked(bool)"`）。
- 槽函数是 Qt 程序中的关键切入点（等同于 Windows 消息处理函数）。
- **Ui 文件**: Qt Designer 生成的 `.ui` 文件有时被嵌入为资源，提取后可了解界面布局。

**Qt 逆向挑战**:
- 槽函数名称可能被混淆（尤其是商业授权中的混淆版）。
- 多线程中信号槽的连接类型（DirectConnection / QueuedConnection）影响调用路径。
- Qt 的布局管理器（Layout）使控件定位不依赖于硬编码坐标。

### 3. 其他 GUI 框架逆向

**WinForms (.NET)**:
- .NET 平台的 Windows GUI 框架，基于托管代码。
- 窗体（Form）和控件（Control）由 C#/VB.NET 代码定义，可通过 dnSpy 直接反编译为 C# 代码。
- UI 逻辑在 `InitializeComponent()` 方法中初始化，按钮点击事件在 `button_Click` 方法中处理。
- 逆向难度主要来自 .NET 混淆器（ConfuserEx 等）。

**WPF (Windows Presentation Foundation)**:
- .NET 的现代 GUI 框架，使用 XAML 描述界面布局。
- XAML 以及资源文件通常嵌入在程序集中，使用 dnSpy 或 WPF Inspector 提取。
- 代码后置（Code-behind）与 XAML 通过 `x:Class` 属性关联。
- 绑定表达式（Binding）的路径字符串提供了数据流的线索。

**GTK+ (GIMP Toolkit)**:
- Linux/Unix 平台的主流 GUI 框架（GNOME 桌面）。
- 信号回调机制通过 `g_signal_connect` 绑定的函数指针实现。
- Glade UI 文件（`.glade`）可能被嵌入或作为单独资源文件。
- IDA 中需要手动识别 GTK+ 的函数模式和回调结构。

**Win32 API 原生 GUI**:
- 直接使用 `CreateWindowEx` / `RegisterClassEx` 等 Win32 API 创建窗口。
- 窗口过程（WindowProc）通过 `switch-case` 处理消息。
- 控件通过句柄（HWND）和 ID 进行管理，无高级框架封装。
- 逆向相对简单，消息处理逻辑集中在一个大函数中（`DialogProc` / `WndProc`）。

**wxWidgets**:
- 跨平台 C++ GUI 类库。
- 事件表（Event Table）类似 MFC 的消息映射表，使用 `BEGIN_EVENT_TABLE / END_EVENT_TABLE` 宏。
- 在逆向中可通过 IDA 的签名搜索定位事件处理函数。

---

## 逆向分析方法

### 通用分析流程
1. **界面分析**: 运行程序，观察界面元素和交互流程，记录按钮/菜单/输入框的位置和功能。
2. **资源提取**: 使用 Resource Hacker / `rcedit` / `strings` 提取对话框、菜单、字符串等资源。
3. **框架识别**: 通过导入 DLL 列表、特征字符串、反汇编模式识别使用的 GUI 框架。
4. **定位事件处理函数**: 
   - MFC: 定位消息映射表。
   - Qt: 搜索槽函数签名或 connect 调用的字符串。
   - WinForms/WPF: dnSpy 直接查看事件处理函数。
5. **分析验证逻辑**: 通常在按钮点击事件或菜单命令中触发关键验证。
6. **动态调试**: 在关键事件处理函数入口设置断点，观察用户交互触发后的执行路径。

### 特殊技巧
- **Spy++**: 使用 Visual Studio 的 Spy++ 工具查看窗口的类名、句柄、消息等。
- **WinSpy++**: 类似 Spy++ 的开源替代品，可查看窗口属性。
- **Windows 钩子**: 设置 `WH_CALLWNDPROC` 钩子监控窗口消息流。
- **Qt 特有**: 使用 QtSpy 等工具监控 Qt 应用的信号槽调用。
- **资源修改**: 修改对话框资源中的按钮 ID 或文本，辅助定位对应的处理函数。

---

## 相关工具

| 工具 | 用途 |
|------|------|
| IDA Pro / Ghidra | 反编译分析 MFC/Qt/Win32 GUI 代码 |
| dnSpy / ILSpy | 反编译 .NET WinForms/WPF 程序 |
| Resource Hacker | 查看/编辑 PE 文件的对话框、菜单、位图资源 |
| Spy++ / WinSpy++ | 窗口属性、消息监控 |
| QtSpy | Qt 应用信号槽监控 |
| WPF Inspector / Snoop | WPF 应用运行时 UI 探测 |
| Process Monitor | 监控 GUI 程序的文件/注册表操作 |
| Cheat Engine | 内存搜索（定位 GUI 控件绑定的数据） |

---

## 防御/对抗建议

- **逻辑隐藏**: 不要在按钮点击等明显事件处理函数中放置关键逻辑，而是隐藏在定时器、自定义消息、或异步回调中。
- **框架定制**: 修改 MFC/Qt 框架源码中的宏和结构体定义，增加逆向分析难度。
- **控件混淆**: 动态创建和销毁控件（而非在资源中静态定义），使静态分析难以定位处理函数。
- **双重界面**: 表面界面不做关键操作，关键操作隐藏在不可见的控件或快捷键中。
- **反 Spy++**: 检测 `SetWinEventHook` 和窗口枚举 API，阻止界面探测工具。

---

## 相关技能

- [逆向分析基础](逆向分析基础.md)
- [高级语言逆向](高级语言逆向.md)
- [可执行文件逆向](可执行文件逆向.md)
