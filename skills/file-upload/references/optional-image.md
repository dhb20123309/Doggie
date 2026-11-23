# 按需图片处理

默认入口上传原始字节，不解码、压缩或计算 checksum。只有产品明确需要压缩时才复制源码并调用它；不要把处理器重新导入默认 `index.ts`。

在项目的 `src/features/file-upload/` 下复制：

```sh
cp skills/file-upload/references/optional/types.ts.txt src/features/file-upload/optionalTypes.ts
cp skills/file-upload/references/optional/fileProcessing.ts.txt src/features/file-upload/fileProcessing.ts
```

然后在选择文件后显式处理，再把返回的轻量 `UploadFile` 交给核心：

```ts
import { createSupabaseUploadService } from '@/features/file-upload';
import { prepareFileForUpload } from '@/features/file-upload/fileProcessing';

const processed = await prepareFileForUpload(file, {
  maxFileSizeBytes: 50 * 1024 * 1024,
});
const fileRef = await service.upload(processed);
```

处理器保留有界 JPEG/PNG 尺寸检查、浏览器解码资源释放、格式校验和显式压缩结果校验。压缩失败应显示结构化错误并停止本次上传；未超过尺寸上限的图片默认仍可原样上传。图片是否压缩、尺寸和质量是产品决定，不由核心猜测。

复制源码后按项目包管理器安装与现有工程兼容的浏览器运行时依赖，并对复制后的真实文件做 strict TypeScript 检查。不要把 checksum、处理后文件名或旧记录状态机当成业务关联字段。
