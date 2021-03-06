import { Notification, clipboard } from 'electron';
import mime from 'mime-types';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Ipc } from './ipc';
import { Setting } from './setting';
import { History } from './history';
import { UploaderProfileManager } from './uploaderProfileManager';
import { AragornCore } from 'aragorn-core';

/** 上传成功之后的文件信息 */
export interface UploadedFileInfo {
  id?: string;
  name?: string;
  url?: string;
  /** 文件类型 MimeType */
  type: string;
  /** 上传器配置 Id */
  uploaderProfileId: string;
  /** 文件路径 */
  path: string;
  /** 文件大小 */
  size?: number;
  /** 上传时间 */
  date: number;
  errorMessage?: string;
}

const setting = Setting.getInstance();
const history = History.getInstance();
const uploaderProfileManager = UploaderProfileManager.getInstance();
const core = new AragornCore();

export class UploaderManager {
  private static instance: UploaderManager;

  static getInstance() {
    if (!UploaderManager.instance) {
      UploaderManager.instance = new UploaderManager();
    }
    return UploaderManager.instance;
  }

  uploaders = core.getAllUploaders();

  async uploadByDifferentUploaderProfileIds(data: { id: string; path: string }[]) {
    const uploaderProfileIds = [...new Set(data.map(item => item.id))];
    const newData = uploaderProfileIds.map(id => {
      const filesPath = data.filter(item => item.id === id).map(item => item.path);
      return {
        id,
        filesPath
      };
    });
    newData.forEach(item => {
      this.upload(item.filesPath, item.id);
    });
  }

  async upload(files: string[], customUploaderProfileId = '', directoryPath?: string, isFromFileManage = false) {
    try {
      const {
        configuration: { defaultUploaderProfileId }
      } = setting;
      const uploaderProfiles = uploaderProfileManager.getAll();
      const uploaderProfile = uploaderProfiles.find(
        uploaderProfile => uploaderProfile.id === (customUploaderProfileId || defaultUploaderProfileId)
      );

      if (!uploaderProfile) {
        let notification;
        if (customUploaderProfileId) {
          notification = new Notification({ title: '上传操作异常', body: `上传器配置不存在` });
        } else {
          const message = uploaderProfiles.length > 0 ? '请配置默认的上传器' : '请添加上传器配置';
          notification = new Notification({ title: '上传操作异常', body: message });
        }
        notification.show();
        return false;
      }

      const uploader = core.getUploaderByName(uploaderProfile.uploaderName);

      if (!uploader) {
        const message = `没有找到${uploaderProfile.uploaderName}上传器`;
        const notification = new Notification({ title: '上传操作异常', body: message });
        notification.show();
        return false;
      }

      uploader.changeOptions(uploaderProfile.uploaderOptions);

      const successRes: UploadedFileInfo[] = [];
      const failRes: UploadedFileInfo[] = [];

      const promises = files.map(async file => {
        const fileExtName = path.extname(file);
        const fileName = uuidv4() + fileExtName;
        const fileType = mime.lookup(file) || '-';
        const baseInfo = {
          id: uuidv4(),
          name: fileName,
          type: fileType,
          path: file,
          date: new Date().getTime(),
          uploaderProfileId: uploaderProfile.id
        };
        const res = await uploader.upload(file, fileName, directoryPath, isFromFileManage);
        if (res.success) {
          successRes.push({ ...baseInfo, ...res.data });
        } else {
          failRes.push({ ...baseInfo, errorMessage: res.desc });
        }
      });

      await Promise.all(promises);

      this.handleAddHistory([...failRes, ...successRes]);

      if (isFromFileManage) {
        Ipc.win.webContents.send('file-upload-reply');
      }

      if (files.length > 1) {
        this.handleBatchUploaded(successRes.length, failRes.length);
      } else {
        this.handleSingleUploaded(successRes[0], failRes[0]);
      }
    } catch (err) {
      const notification = new Notification({ title: '上传操作异常', body: err.message });
      notification.show();
    }
  }

  async getFileList(uploaderProfileId: string, directoryPath?: string) {
    const uploader = this.getUploader(uploaderProfileId);
    if (uploader?.getFileList) {
      const data = await uploader.getFileList(directoryPath);
      Ipc.win.webContents.send('file-list-get-reply', data);
    } else {
      Ipc.win.webContents.send('file-list-get-reply', []);
    }
  }

  async deleteFile(uploaderProfileId: string, fileNames: string[]) {
    const uploader = this.getUploader(uploaderProfileId);
    if (uploader?.deleteFile) {
      const res = await uploader.deleteFile(fileNames);
      Ipc.win.webContents.send('file-delete-reply', res);
    } else {
      Ipc.win.webContents.send('file-delete-reply', false);
    }
  }

  async createDirectory(uploaderProfileId: string, directoryPath: string) {
    const uploader = this.getUploader(uploaderProfileId);
    if (uploader?.createDirectory) {
      const data = await uploader.createDirectory(directoryPath);
      Ipc.win.webContents.send('directory-create-reply', data);
    } else {
      Ipc.win.webContents.send('directory-create-reply', false);
    }
  }

  protected getUploader(id: string) {
    const uploaderProfiles = uploaderProfileManager.getAll();
    const uploaderProfile = uploaderProfiles.find(uploaderProfile => uploaderProfile.id === id);
    if (!uploaderProfile) {
      return;
    }
    const uploader = core.getUploaderByName(uploaderProfile.uploaderName);
    if (uploader) {
      uploader.changeOptions(uploaderProfile.uploaderOptions);
      return uploader;
    }
  }

  protected handleBatchUploaded(successFilesCount: number, failFilesCount: number) {
    if (failFilesCount === 0) {
      const notification = new Notification({ title: '批量上传成功', body: `总共${successFilesCount}个文件` });
      notification.show();
    } else if (successFilesCount === 0) {
      const notification = new Notification({ title: '批量上传失败', body: `总共${failFilesCount}个文件` });
      notification.show();
    } else {
      const notification = new Notification({
        title: '批量上传结束',
        body: `成功${successFilesCount}个，失败${failFilesCount}个`
      });
      notification.show();
    }
  }

  protected handleSingleUploaded(successFile: UploadedFileInfo, failFile: UploadedFileInfo) {
    if (successFile) {
      // 根据urlType转换图片链接格式
      let clipboardUrl = successFile.url;
      switch (setting.configuration.urlType) {
        case 'URL':
          break;
        case 'HTML':
          clipboardUrl = `<img src="${successFile.url}" />`;
          break;
        case 'Markdown':
          clipboardUrl = `![${successFile.url}](${successFile.url})`;
          break;
        default:
          return successFile.url;
      }
      if (setting.configuration.autoCopy) {
        let preClipBoardText = '';
        if (setting.configuration.autoRecover) {
          preClipBoardText = clipboard.readText();
        }
        // 开启自动复制
        clipboard.writeText(clipboardUrl || '');
        const notification = new Notification({
          title: '上传成功',
          body: '链接已自动复制到粘贴板',
          silent: !setting.configuration.sound
        });
        setting.configuration.showNotifaction && notification.show();
        setting.configuration.autoRecover &&
          setTimeout(() => {
            clipboard.writeText(preClipBoardText);
            const notification = new Notification({
              title: '粘贴板已恢复',
              body: '已自动恢复上次粘贴板中的内容',
              silent: !setting.configuration.sound
            });
            notification.show();
          }, 5000);
      } else {
        const notification = new Notification({
          title: '上传成功',
          body: clipboardUrl || '',
          silent: !setting.configuration.sound
        });
        setting.configuration.showNotifaction && notification.show();
      }
    } else {
      const notification = new Notification({ title: '上传失败', body: failFile.errorMessage || '错误未捕获' });
      notification.show();
    }
  }

  protected handleAddHistory(uploadedData: UploadedFileInfo[]) {
    const uploadedFiles = history.add(uploadedData);
    if (!Ipc.win.isDestroyed()) {
      Ipc.win.webContents.send('uploaded-files-get-reply', uploadedFiles);
    }
  }
}
