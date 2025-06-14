const { app, BrowserWindow, screen, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow
const windowStateFile = 'window-state.json'
const sentenceStateFile = 'sentence-state.json'

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
    height: Math.floor(height * 0.7)
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

function getCurrentDayIndex() {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 0)
  const diff = now - start
  const oneDay = 1000 * 60 * 60 * 24
  return Math.floor(diff / oneDay)
}

function getNextSentences(allSentences) {
  try {
    const data = fs.readFileSync(sentenceStateFile, 'utf8')
    const { lastDay, lastIndex } = JSON.parse(data)
    const currentDay = getCurrentDayIndex()
    
    if (lastDay === currentDay) {
      // 同一天，返回相同的句子
      const index1 = lastIndex % allSentences.length
      const index2 = (lastIndex + 1) % allSentences.length
      return [allSentences[index1], allSentences[index2]]
    } else {
      // 新的一天，返回下一组句子
      const newIndex = (lastIndex + 2) % allSentences.length
      fs.writeFileSync(sentenceStateFile, JSON.stringify({
        lastDay: currentDay,
        lastIndex: newIndex
      }))
      const index1 = newIndex % allSentences.length
      const index2 = (newIndex + 1) % allSentences.length
      return [allSentences[index1], allSentences[index2]]
    }
  } catch (err) {
    // 首次运行或文件损坏，从第一句开始
    const currentDay = getCurrentDayIndex()
    fs.writeFileSync(sentenceStateFile, JSON.stringify({
      lastDay: currentDay,
      lastIndex: 0
    }))
    return allSentences.length >= 2 
      ? [allSentences[0], allSentences[1]]
      : allSentences.length === 1
        ? [allSentences[0], allSentences[0]]
        : ["请添加句子到文件", "请添加句子到文件"]
  }
}

function loadAndSendSentences(filePath, window) {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('无法读取句子文件:', err)
      window.webContents.send('file-error', '无法找到或读取句子文件')
      return
    }
    
    const allSentences = data.split('\n').filter(s => s.trim() !== '')
    if (allSentences.length < 1) {
      window.webContents.send('file-error', '句子文件中至少需要1个句子')
      return
    }
    
    const selectedSentences = getNextSentences(allSentences)
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
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'build/icon/favicon.jpg')
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
        // 重置句子索引
        fs.unlinkSync(sentenceStateFile)
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
