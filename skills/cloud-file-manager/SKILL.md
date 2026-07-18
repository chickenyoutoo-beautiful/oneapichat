---
name: cloud-file-manager
description: 云盘文件管理+服务器文件联动。Cloudreve云盘操作+服务器文件搜索/编辑。Use for cloud storage management, file sharing, and server file operations.
version: 1.0.0
metadata:
  oneapichat:
    tools: [cr_login, cr_user_info, cr_list_files, cr_search_files, cr_create_folder, cr_rename, cr_move, cr_copy, cr_delete, cr_list_shares, cr_create_share, cr_delete_share, cr_storage_info, cr_overview, server_file_read, server_file_write, server_file_search]
    priority: medium
    emoji: "☁️"
    triggers: [云盘, 网盘, 文件管理, 分享文件, 上传, 下载, Cloudreve, 存储, 空间, 文件列表, 找文件]
---

# 云盘文件管理

Cloudreve云盘+服务器文件系统统一管理。文件上传下载、分享外链、空间管理一站式。

## 何时使用

- 管理Cloudreve云盘文件
- 创建/管理文件分享链接
- 查看存储空间使用情况
- 在服务器上搜索/读取文件
- 云盘和服务器之间移动文件

## 工作流

### 文件浏览
```
cr_login → 确保登录
cr_list_files → 浏览目录
cr_search_files → 搜索文件(全局搜索)
cr_storage_info → 查看空间配额
cr_overview → 总览(文件数/分享数/存储)
```

### 文件操作
```
cr_create_folder → 新建文件夹
cr_rename → 重命名
cr_move → 移动到其他目录
cr_copy → 复制
cr_delete → 删除(谨慎!)
```

### 分享管理
```
cr_create_share → 创建分享链接(可设密码/有效期)
cr_list_shares → 查看所有分享
cr_delete_share → 取消分享
```

### 服务器联动
```
server_file_search → 在服务器上搜文件
server_file_read → 读取服务器文件内容
server_file_write → 写入文件到服务器
```

## 常用场景

### 场景1: 找文件并分享
```
1. cr_search_files → 找到目标文件
2. cr_create_share → 创建分享链接
3. 返回链接给用户
```

### 场景2: 清理空间
```
1. cr_storage_info → 查看使用情况
2. cr_list_files → 找到大文件/旧文件
3. cr_delete → 清理(确认后)
```

### 场景3: 跨存储操作
```
1. server_file_read → 读取服务器日志/配置
2. cr_create_folder → 在云盘创建备份目录
3. server_file_write → 或手动备份到云盘
```

## 输出格式

```
☁️ 云盘状态
- 用户: {用户名} ({已用空间}/{总空间})
- 文件数: {N} | 文件夹: {M} | 分享: {K}

📁 当前目录: /documents
| 名称 | 大小 | 修改时间 |
|------|------|---------|
| report.pdf | 2.3MB | 07-15 |
| photos/ | - | 07-10 |
```

## 技巧

1. 删除前先确认——`cr_delete` 不可逆
2. 分享链接可设密码保护敏感文件
3. `cr_search_files` 支持模糊搜索，比逐级浏览更快
4. 大文件操作可能需要时间，注意超时
