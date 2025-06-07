const { app, BrowserWindow, screen, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow
const windowStateFile = 'window-state.json'

function getSentencesFilePath() {
  if (!app.isPackaged) {
    return path.join(__dirname, 'sentences.txt')
  }
  return path.join(path.dirname(app.getPath('exe')), 'sentences.txt')
}

function getDefaultWindowPosition() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  return {
    x: width - Math.floor(width * 0.5),
    y: 0,
    width: Math.floor(width * 0.5),
    height: height  // 改为全高
  }
}

function saveWindowPosition(window) {
  const position = window.getPosition()
  const size = window.getSize()
  fs.writeFileSync(windowStateFile, JSON.stringify({
    x: position[0],
    y: position[1],
    width: size[0],
    height: size[1]
  }))
}

function tryLoadWindowPosition() {
  try {
    const data = fs.readFileSync(windowStateFile, 'utf8')
    const { x, y, width, height } = JSON.parse(data)
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
    
    if (x >= 0 && y >= 0 && 
        width > 100 && height > 100 &&
        x + width <= screenWidth && 
        y + height <= screenHeight) {
      return { x, y, width, height }
    }
  } catch (err) {
    console.log('使用默认窗口位置')
  }
  return getDefaultWindowPosition()
}

function selectRandomSentences(sentences, count, seed) {
  const shuffled = [...sentences]
  let currentSeed = seed
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    currentSeed = (currentSeed * 9301 + 49297) % 233280
    const j = Math.floor(currentSeed / 233280 * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  
  return shuffled.slice(0, count)
}

function loadAndSendSentences(filePath, window) {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('无法读取句子文件:', err)
      window.webContents.send('file-error', '无法找到或读取句子文件')
      return
    }
    
    const allSentences = data.split('\n').filter(s => s.trim() !== '')
    if (allSentences.length < 3) {
      window.webContents.send('file-error', '句子文件中至少需要3个句子')
      return
    }
    
    const today = new Date().toDateString()
    const seed = today.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
    const selectedSentences = selectRandomSentences(allSentences, 3, seed)
    
    window.webContents.send('update-sentences', selectedSentences)
  })
}

function createWindow() {
  const { x, y, width, height } = tryLoadWindowPosition()
  
  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#00000000'
  })

  mainWindow.setBackgroundColor('#00000000')

  mainWindow.loadFile('index.html')

  mainWindow.on('moved', () => {
    saveWindowPosition(mainWindow)
  })

  mainWindow.on('resized', () => {
    saveWindowPosition(mainWindow)
  })

  loadAndSendSentences(getSentencesFilePath(), mainWindow)

  ipcMain.on('reload-sentences', () => {
    loadAndSendSentences(getSentencesFilePath(), mainWindow)
  })

  ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    
    if (!result.canceled && result.filePaths.length > 0) {
      try {
        const targetPath = getSentencesFilePath()
        fs.copyFileSync(result.filePaths[0], targetPath)
        return targetPath
      } catch (err) {
        console.error('复制文件失败:', err)
        return null
      }
    }
    return null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
