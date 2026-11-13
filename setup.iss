; Installer of Giữ thành (Inno Setup 6). Built by build_setup.bat, which passes the version:
;   ISCC /DAppVersion=0.3.0 setup.iss
; Per user, no administrator rights: installs into %LOCALAPPDATA%\Programs\TikTokGiuThanh.
; The settings and the session (players, matches) live in %APPDATA%\TikTokGiuThanh: kept on update; on uninstall the
; user is asked whether to delete them. TikTok Live Hub is inside the app: nothing else to install.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\TikTokGiuThanh"
#endif

[Setup]
AppId={{8E3DDA68-A10E-48CA-81C2-E731A396C421}
AppName=Giữ thành
AppVersion={#AppVersion}
AppVerName=Giữ thành {#AppVersion}
AppPublisher=TikTok Giu Thanh
DefaultDirName={autopf}\TikTokGiuThanh
DefaultGroupName=Giữ thành
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=release
OutputBaseFilename=TikTokGiuThanh-Setup-{#AppVersion}
SetupIconFile=web\public\icon.ico
UninstallDisplayIcon={app}\TikTokGiuThanh.exe
UninstallDisplayName=Giữ thành
Compression=lzma2/fast
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=8
SolidCompression=no
WizardStyle=modern
; the app holds this mutex while it runs (giuthanh/app.py APP_MUTEX): update / uninstall ask to close it first
AppMutex=TikTokGiuThanh_Running
; held while setup runs: the app's guard does not start the game again under it (giuthanh/lifecycle.py SETUP_MUTEX)
SetupMutex=TikTokGiuThanh_Setup
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "vi"; MessagesFile: "compiler:Default.isl"

[Messages]
; Inno Setup has no Vietnamese file: the lines people see most, in Vietnamese
SetupWindowTitle=Cài đặt %1
WelcomeLabel1=Cài đặt [name]
WelcomeLabel2=Chương trình sẽ cài [name/ver] vào máy.%n%nTikTok Live Hub đã có sẵn bên trong: mở game là nhận được bình luận và vật phẩm của phòng live.
ButtonNext=&Tiếp >
ButtonBack=< &Lùi
ButtonInstall=&Cài đặt
ButtonCancel=Hủy
ButtonFinish=&Xong
ButtonYes=&Có
ButtonNo=&Không
ButtonBrowse=&Chọn...
SelectDirLabel3=Giữ thành sẽ được cài vào thư mục dưới đây.
SelectDirBrowseLabel=Bấm Tiếp để cài, hoặc Chọn... để đổi thư mục.
SelectTasksLabel2=Chọn thêm rồi bấm Tiếp.
ReadyLabel1=Sẵn sàng cài [name].
ReadyLabel2a=Bấm Cài đặt để bắt đầu.
InstallingLabel=Đang cài [name]...
FinishedHeadingLabel=Đã cài xong [name]
FinishedLabel=Giữ thành đã được cài. Mở từ lối tắt trên Desktop hoặc Start Menu.
FinishedLabelNoIcons=Giữ thành đã được cài.
RunEntryExec=Mở %1
SetupAppRunningError=Giữ thành đang mở.%n%nĐóng ứng dụng rồi bấm OK để tiếp tục, hoặc Hủy để dừng cài.
UninstallAppRunningError=Giữ thành đang mở.%n%nĐóng ứng dụng rồi bấm OK để tiếp tục, hoặc Hủy để dừng gỡ.
ConfirmUninstall=Gỡ %1 khỏi máy?%n%nSau đó sẽ hỏi có xoá luôn dữ liệu (người chơi, cài đặt, giọng đọc) hay giữ lại để cài lại vẫn dùng tiếp.
UninstalledAll=Đã gỡ %1 khỏi máy.
ExitSetupTitle=Thoát cài đặt
ExitSetupMessage=Chưa cài xong. Thoát bây giờ thì Giữ thành sẽ không được cài.%n%nThoát cài đặt?

[Tasks]
Name: "desktopicon"; Description: "Tạo lối tắt trên Desktop"; GroupDescription: "Lối tắt:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; an update replaces the whole program (no leftover files of an older version); settings are elsewhere
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{autoprograms}\Giữ thành"; Filename: "{app}\TikTokGiuThanh.exe"
Name: "{autodesktop}\Giữ thành"; Filename: "{app}\TikTokGiuThanh.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\TikTokGiuThanh.exe"; Description: "{cm:LaunchProgram,Giữ thành}"; Flags: nowait postinstall skipifsilent

[CustomMessages]
vi.LaunchProgram=Mở %1 ngay

[Code]
const
  WEBVIEW2_KEY = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WEBVIEW2_URL = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

function HasWebView2(): Boolean;
var
  v: String;
begin
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) and (v <> '') and (v <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM, WEBVIEW2_KEY, 'pv', v) and (v <> '') and (v <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, WEBVIEW2_KEY, 'pv', v) and (v <> '') and (v <> '0.0.0.0'));
end;

// uninstall: the data stays unless the user says so: players, settings, the session, the voice model when this app
// downloaded its own, and app.log are in %APPDATA%\TikTokGiuThanh. Nothing of the map game is ever touched.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  data: String;
begin
  if CurUninstallStep <> usPostUninstall then Exit;
  data := ExpandConstant('{userappdata}\TikTokGiuThanh');
  if not DirExists(data) then Exit;
  if UninstallSilent() then Exit;
  if MsgBox('Xoá luôn dữ liệu của Giữ thành?' + #13#10 + #13#10 +
            'Gồm người chơi, tỉ số, cài đặt, nhật ký và giọng đọc đã tải, trong:' + #13#10 + data + #13#10 + #13#10 +
            'Có: xoá hết, cài lại sẽ bắt đầu từ đầu.' + #13#10 + 'Không: giữ lại, cài lại vẫn chơi tiếp như cũ.',
            mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    DelTree(data, True, True, True);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  code: Integer;
begin
  // the windows of the app are drawn by Microsoft Edge WebView2 (built into Windows 11, usually there on Windows 10)
  if (CurStep = ssPostInstall) and (not WizardSilent()) and (not HasWebView2()) then
    if MsgBox('Máy này chưa có Microsoft Edge WebView2 Runtime: ứng dụng cần nó để hiện cửa sổ.' + #13#10 + #13#10 +
              'Mở trang tải của Microsoft bây giờ? (cài xong WebView2 rồi mở lại ứng dụng)', mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('open', WEBVIEW2_URL, '', '', SW_SHOWNORMAL, ewNoWait, code);
end;
