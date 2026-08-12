# sharp 图片规范化测试数据

`sharp-orientation-6.jpg` 是本仓库生成的合成测试图，只包含四个纯色象限，不含用户图片、人脸、舌象、账号、设备、位置或网络来源数据。

## 来源与生成

- 生成脚本：`generate-sharp-orientation-fixture.mjs`
- 生成命令：`node tests/fixtures/images/generate-sharp-orientation-fixture.mjs`
- 生成环境：Node `v24.15.0`、sharp `0.34.5`、libvips `8.17.3`
- 物理尺寸：`2560×1280`
- 原始象限：左上红、右上绿、左下蓝、右下黄
- EXIF Orientation：`6`（显示时顺时针旋转 90°）
- 编码：JPEG，quality 95，4:4:4
- 文件大小：`40580` 字节
- SHA-256：`5789c7cc69d0e2ec757cccb5f60fa8213785ed48b77735a31624b51f3313dbc6`

测试只读取已提交的固定 JPEG，不在测试执行时调用生成脚本。生成脚本不访问网络、环境变量或工作区业务数据，仅用于复现该无隐私 fixture；它随本项目源码按仓库许可使用。sharp 包声明 Apache-2.0；本轮 Windows x64 预构建包元数据声明 `Apache-2.0 AND LGPL-3.0-or-later`。
