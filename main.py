import json
import queue
import sys
import sounddevice as sd
from PyQt5 import QtCore, QtGui, QtWidgets
from vosk import KaldiRecognizer, Model
import os
import datetime

audio_queue = queue.Queue()


def audio_callback(indata, frames, time, status):
  audio_queue.put(bytes(indata))


class TranscriptionWorker(QtCore.QThread):
  text_ready = QtCore.pyqtSignal(str, bool)

  def __init__(self, device_index):
    super().__init__()
    self.device_index = device_index
    self.running = True
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    self.model = Model(os.path.join(BASE_DIR, "model", "vosk-model-fr-0.22"))
    self.recognizer = KaldiRecognizer(self.model, 16000)

  def run(self):
    with sd.RawInputStream(
        samplerate=16000,
        blocksize=8000,
        device=self.device_index,
        dtype="int16",
        channels=1,
        callback=audio_callback,
    ):
      while self.running:
        try:
          data = audio_queue.get(timeout=0.2)
          if self.recognizer.AcceptWaveform(data):
            res = json.loads(self.recognizer.Result())
            if res.get("text"):
              self.text_ready.emit(res["text"], True)
          else:
            partial = json.loads(self.recognizer.PartialResult())
            if partial.get("partial"):
              self.text_ready.emit(partial["partial"] + "...", False)
        except queue.Empty:
          continue

  def stop(self):
    self.running = False
    self.wait()


class DragButton(QtWidgets.QPushButton):
    def __init__(self, title, parent=None):
        super().__init__(title, parent)
        self.old_pos = None

    def mousePressEvent(self, event):
        if event.button() == QtCore.Qt.LeftButton:
            self.old_pos = event.globalPos()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self.old_pos:
            delta = event.globalPos() - self.old_pos
            window = self.window()
            window.move(window.x() + delta.x(), window.y() + delta.y())
            self.old_pos = event.globalPos()
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self.old_pos = None
        super().mouseReleaseEvent(event)

class ResizeButton(QtWidgets.QPushButton):
    def __init__(self, title, parent=None):
        super().__init__(title, parent)
        self.old_pos = None
        self.setCursor(QtCore.Qt.SizeFDiagCursor)

    def mousePressEvent(self, event):
        if event.button() == QtCore.Qt.LeftButton:
            self.old_pos = event.globalPos()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self.old_pos:
            delta = event.globalPos() - self.old_pos
            window = self.window()
            new_width = max(window.minimumWidth(), window.width() + delta.x())
            new_height = max(window.minimumHeight(), window.height() + delta.y())
            window.resize(new_width, new_height)
            self.old_pos = event.globalPos()
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self.old_pos = None
        super().mouseReleaseEvent(event)

class OverlayApp(QtWidgets.QWidget):

  def __init__(self):
    super().__init__()
    self.worker = None
    self.old_pos = None
    self.current_color = "#FFFFFF"
    self.transcription_history = []

    self.init_ui()

  def init_ui(self):
    # Fenêtre sans bordure, au premier plan
    self.setWindowFlags(
        QtCore.Qt.FramelessWindowHint | QtCore.Qt.WindowStaysOnTopHint
    )
    self.setAttribute(QtCore.Qt.WA_TranslucentBackground, True)
    self.resize(600, 200)

    # Layout principal
    layout = QtWidgets.QVBoxLayout(self)
    layout.setContentsMargins(10, 10, 10, 10)

    # Barre de contrôles (masquable ou compacte)
    self.controls_widget = QtWidgets.QWidget()
    controls = QtWidgets.QHBoxLayout(self.controls_widget)
    controls.setContentsMargins(0, 0, 0, 0)

    # Sélection du micro
    self.combo_mics = QtWidgets.QComboBox()
    self.refresh_audio_devices()
    controls.addWidget(self.combo_mics)

    # Bouton Démarrer / Arrêter
    self.btn_toggle = QtWidgets.QPushButton("Démarrer")
    self.btn_toggle.clicked.connect(self.toggle_transcription)
    controls.addWidget(self.btn_toggle)

    # Sélecteur de couleur
    self.btn_color = QtWidgets.QPushButton("Couleur")
    self.btn_color.clicked.connect(self.choose_color)
    controls.addWidget(self.btn_color)

    # Taille du texte
    self.spin_size = QtWidgets.QSpinBox()
    self.spin_size.setRange(12, 60)
    self.spin_size.setValue(22)
    self.spin_size.valueChanged.connect(self.update_font_size)
    controls.addWidget(self.spin_size)

    # Bouton Réduire
    btn_min = QtWidgets.QPushButton("-")
    btn_min.setFixedWidth(30)
    btn_min.clicked.connect(self.showMinimized)
    controls.addWidget(btn_min)

    # Bouton Fermer
    btn_close = QtWidgets.QPushButton("✕")
    btn_close.setFixedWidth(30)
    btn_close.clicked.connect(self.close)
    controls.addWidget(btn_close)

    layout.addWidget(self.controls_widget)

    # Zone d'affichage du texte
    self.text_display = QtWidgets.QTextEdit()
    self.text_display.setReadOnly(True)
    self.text_display.setStyleSheet(
        "background-color: rgba(0, 0, 0, 140); border-radius: 8px;"
    )
    layout.addWidget(self.text_display)

    bottom_layout = QtWidgets.QHBoxLayout()
    
    self.btn_move = DragButton("✥ Déplacer")
    self.btn_move.setFixedSize(90, 25)
    self.btn_move.setStyleSheet("background-color: rgba(255,255,255,150); border-radius: 4px; font-weight: bold;")
    bottom_layout.addWidget(self.btn_move)
    
    self.btn_hide_menu = QtWidgets.QPushButton("⚙️ Menu")
    self.btn_hide_menu.setFixedSize(70, 25)
    self.btn_hide_menu.clicked.connect(self.toggle_menu)
    self.btn_hide_menu.setStyleSheet("background-color: rgba(255,255,255,150); border-radius: 4px;")
    bottom_layout.addWidget(self.btn_hide_menu)
    
    bottom_layout.addStretch()
    
    self.btn_resize = ResizeButton("↘ Étirer")
    self.btn_resize.setFixedSize(80, 25)
    self.btn_resize.setStyleSheet("background-color: rgba(255,255,255,150); border-radius: 4px; font-weight: bold;")
    bottom_layout.addWidget(self.btn_resize, 0, QtCore.Qt.AlignBottom | QtCore.Qt.AlignRight)
    
    layout.addLayout(bottom_layout)

    self.update_text_style()

  def refresh_audio_devices(self):
    devices = sd.query_devices()
    for idx, dev in enumerate(devices):
      if dev["max_input_channels"] > 0:
        self.combo_mics.addItem(f"{dev['name']}", idx)

  def choose_color(self):
    color = QtWidgets.QColorDialog.getColor()
    if color.isValid():
      self.current_color = color.name()
      self.update_text_style()

  def update_font_size(self):
    self.update_text_style()

  def update_text_style(self):
    size = self.spin_size.value()
    self.text_display.setStyleSheet(f"""
            background-color: rgba(0, 0, 0, 150);
            color: {self.current_color};
            font-size: {size}px;
            font-weight: bold;
            border-radius: 8px;
            padding: 8px;
        """)

  def toggle_menu(self):
    self.controls_widget.setVisible(not self.controls_widget.isVisible())

  def save_transcription(self):
    if not self.transcription_history:
        return
    
    transcriptions_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "transcriptions")
    if not os.path.exists(transcriptions_dir):
        os.makedirs(transcriptions_dir)
        
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filepath = os.path.join(transcriptions_dir, f"transcription_{timestamp}.txt")
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(self.transcription_history))
    
    self.transcription_history = []
    print(f"Transcription saved to {filepath}")

  def toggle_transcription(self):
    if self.worker is None or not self.worker.isRunning():
      self.transcription_history = []
      device_idx = self.combo_mics.currentData()
      self.worker = TranscriptionWorker(device_idx)
      self.worker.text_ready.connect(self.display_text)
      self.worker.start()
      self.btn_toggle.setText("Arrêter")
    else:
      self.worker.stop()
      self.worker = None
      self.btn_toggle.setText("Démarrer")
      self.save_transcription()

  def display_text(self, text, is_final):
    self.text_display.setPlainText(text)
    self.text_display.verticalScrollBar().setValue(
        self.text_display.verticalScrollBar().maximum()
    )
    if is_final and text.strip():
        self.transcription_history.append(text.strip())


if __name__ == "__main__":
  app = QtWidgets.QApplication(sys.argv)
  window = OverlayApp()
  window.show()
  sys.exit(app.exec_())