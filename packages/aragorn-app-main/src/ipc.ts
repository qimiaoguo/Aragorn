import { ipcMain, BrowserWindow } from 'electron';
import { Updater } from './updater';
import { Setting } from './setting';
import { History } from './history';
import { UploaderManager } from './uploaderManager';
import { UploaderProfileManager, UploaderProfile } from './uploaderProfileManager';
import { AragornCore } from 'aragorn-core';

const updater = Updater.getInstance();
const setting = Setting.getInstance();
const history = History.getInstance();
const uploaderProfileManager = UploaderProfileManager.getInstance();
const core = new AragornCore();

export class Ipc {
  static win: BrowserWindow;

  private static instance: Ipc;

  static getInstance() {
    if (!Ipc.instance) {
      Ipc.instance = new Ipc();
    }
    return Ipc.instance;
  }

  static sendMessage(channel: string, channelData: any) {
    Ipc.win.webContents.send(channel, channelData);
  }

  init() {
    this.appUpdateHandlee();
    this.uploadHandle();
    this.settingHandle();
    this.uploaderProfileHandle();
    this.fileManageHandle();
  }

  protected appUpdateHandlee() {
    const { autoUpdate } = setting.get();
    if (autoUpdate) {
      updater.checkUpdate(false);
    }
    ipcMain.on('check-update', (_, manul = false) => {
      updater.checkUpdate(manul);
    });
  }

  protected uploadHandle() {
    ipcMain.on('file-upload-by-side-menu', (_, filesPath: string[]) => {
      new UploaderManager().upload(filesPath);
    });

    ipcMain.on('file-reupload', (_, data) => {
      new UploaderManager().uploadByDifferentUploaderProfileIds(data);
    });

    ipcMain.on('uploaded-files-get', event => {
      const uploadedFiles = history.get();
      event.reply('uploaded-files-get-reply', uploadedFiles);
    });

    ipcMain.on('clear-upload-history', (event, ids: string[]) => {
      const uploadedFiles = history.clear(ids);
      event.reply('uploaded-files-get-reply', uploadedFiles);
    });
  }

  protected settingHandle() {
    ipcMain.on('setting-configuration-get', event => {
      const configuration = setting.get();
      event.reply('setting-configuration-get-reply', configuration);
    });

    ipcMain.on('setting-configuration-update', (event, newConfiguration) => {
      const configuration = setting.update(newConfiguration);
      if (configuration) {
        event.reply('setting-configuration-update-reply', configuration);
      }
    });

    ipcMain.on('set-default-uploader-profile', (event, id) => {
      const configuration = setting.setDefaultUploaderProfile(id);
      event.reply('setting-configuration-get-reply', configuration);
    });
  }

  protected uploaderProfileHandle() {
    ipcMain.on('uploaders-get', event => {
      const uploaders = core.getAllUploaders();
      event.reply('uploaders-get-reply', JSON.parse(JSON.stringify(uploaders)));
    });

    ipcMain.on('uploader-profiles-get', event => {
      const uploaderProfiles = uploaderProfileManager.getAll();
      event.reply('uploader-profiles-get-reply', uploaderProfiles);
    });

    ipcMain.on('uploader-profile-add', (event, newUploaderProfile: UploaderProfile) => {
      const uploaderProfile = uploaderProfileManager.add(newUploaderProfile);
      if (uploaderProfile) {
        uploaderProfile.isDefault && setting.setDefaultUploaderProfile(uploaderProfile.id);
        event.reply('uploader-profiles-get-reply', uploaderProfileManager.getAll());
        event.reply('uploader-profile-add-reply', uploaderProfile);
        event.reply('setting-configuration-get-reply', setting.get());
      }
    });

    ipcMain.on('uploader-profile-update', (event, newUploaderProfile: UploaderProfile) => {
      const uploaderProfiles = uploaderProfileManager.update(newUploaderProfile);
      if (uploaderProfiles) {
        event.reply('uploader-profiles-get-reply', uploaderProfiles);
        event.reply('uploader-profile-update-reply', true);
      }
    });

    ipcMain.on('uploader-profile-delete', (event, id: string) => {
      const uploaderProfiles = uploaderProfileManager.delete(id);
      if (uploaderProfiles) {
        event.reply('uploader-profiles-get-reply', uploaderProfiles);
        event.reply('uploader-profile-delete-reply', true);
        setting.deleteDefaultUploaderProfile(id);
        event.reply('setting-configuration-get-reply', setting.get());
      }
    });
  }

  protected fileManageHandle() {
    ipcMain.on('file-list-get', (_, uploaderProfileId: string, directoryPath?: string) => {
      new UploaderManager().getFileList(uploaderProfileId, directoryPath);
    });

    ipcMain.on('file-delete', (_, uploaderProfileId: string, fileNames: string[]) => {
      new UploaderManager().deleteFile(uploaderProfileId, fileNames);
    });

    ipcMain.on('file-upload', (_, uploaderProfileId: string, filesPath: string[], directoryPath?: string) => {
      new UploaderManager().upload(filesPath, uploaderProfileId, directoryPath, true);
    });

    ipcMain.on('directory-create', (_, uploaderProfileId: string, directoryPath: string) => {
      new UploaderManager().createDirectory(uploaderProfileId, directoryPath);
    });
  }
}
