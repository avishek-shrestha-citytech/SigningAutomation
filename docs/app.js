// ============================================================
// SECURITY: Everything runs inside an IIFE closure.
// The passcode is stored in a local variable that cannot be
// accessed from window, document, or the browser console.
// ============================================================
(function () {
  'use strict';

  const WORKER_URL = 'https://apk-upload-proxy.abhishrestha987.workers.dev';

  // Closure-scoped passcode. Inaccessible from DevTools console.
  let _verifiedPasscode = '';

  // ---- LOCK SCREEN LOGIC ----
  const passcodeInput = document.getElementById('passcodeInput');
  const lockError = document.getElementById('lockError');
  const unlockBtn = document.getElementById('unlockBtn');

  // Allow Enter key to submit
  passcodeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') unlock();
  });

  async function unlock() {
    const code = passcodeInput.value.trim();
    if (!code) {
      showLockError('Please enter a passcode');
      return;
    }

    unlockBtn.disabled = true;
    unlockBtn.textContent = 'Verifying...';
    lockError.textContent = '';
    passcodeInput.classList.remove('error');

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: {
          'X-Action': 'verify-passcode',
          'Content-Type': 'application/json',
          'X-Passcode': code
        },
        body: JSON.stringify({})
      });

      if (res.ok) {
        // Store passcode in closure (not on window!)
        _verifiedPasscode = code;

        // Animate lock screen away
        const lockScreen = document.getElementById('lockScreen');
        lockScreen.classList.add('unlocked');

        // After animation, remove lock and inject upload UI
        setTimeout(function () {
          lockScreen.remove();
          injectUploadUI();
        }, 400);
      } else if (res.status === 429) {
        // Rate limited — lock the form with a countdown
        unlockBtn.disabled = true;
        passcodeInput.disabled = true;
        var remaining = 300;
        showLockError('Too many attempts. Try again in 5:00');
        var countdown = setInterval(function () {
          remaining--;
          var mins = Math.floor(remaining / 60);
          var secs = remaining % 60;
          lockError.textContent = 'Too many attempts. Try again in ' + mins + ':' + (secs < 10 ? '0' : '') + secs;
          if (remaining <= 0) {
            clearInterval(countdown);
            unlockBtn.disabled = false;
            passcodeInput.disabled = false;
            lockError.textContent = '';
          }
        }, 1000);
        return; // Skip re-enabling the button below
      } else {
        const data = await res.json().catch(function () { return {}; });
        showLockError(data.error || 'Incorrect Passcode');
        passcodeInput.classList.add('error');
        passcodeInput.focus();
        passcodeInput.select();
      }
    } catch (err) {
      showLockError('Connection error. Please try again.');
    }

    unlockBtn.disabled = false;
    unlockBtn.textContent = 'Unlock';
  }

  // Button click registered AFTER function declaration to avoid hoisting ambiguity in strict-mode IIFE
  unlockBtn.addEventListener('click', unlock);

  function showLockError(msg) {
    lockError.textContent = msg;
    passcodeInput.classList.add('error');
    setTimeout(function () { passcodeInput.classList.remove('error'); }, 600);
  }

  // ---- DYNAMIC UPLOAD UI INJECTION ----
  function injectUploadUI() {
    const rightSection = document.getElementById('rightSection');

    const card = document.createElement('div');
    card.className = 'upload-card';
    card.innerHTML = `
      <div class="card-header">
        <h2>Upload APK</h2>
      </div>

      <div class="drop-zone" id="dropZone">
        <input type="file" id="fileInput" accept=".apk">
        <span class="drop-icon">📦</span>
        <div class="drop-text">Drag & drop your APK</div>
        <p class="drop-hint">or click to browse</p>
        <div class="file-info" id="fileInfo"></div>
      </div>

      <div class="progress-bar" id="progressBar">
        <div class="progress-fill"></div>
      </div>

      <div class="progress-text" id="progressText">0%</div>

      <div class="stepper" id="stepper">
        <div class="step" id="step1">
          <div class="step-icon">1</div>
          <div>Upload</div>
        </div>
        <div class="step" id="step2">
          <div class="step-icon">2</div>
          <div>Process</div>
        </div>
        <div class="step" id="step3">
          <div class="step-icon">3</div>
          <div>Signing</div>
        </div>
        <div class="step" id="step4">
          <div class="step-icon">4</div>
          <div>Ready</div>
        </div>
      </div>

      <div class="status" id="status"></div>

      <button class="download-btn" id="downloadBtn">
        ⬇️ Download Signed APK
      </button>
    `;

    rightSection.appendChild(card);
    initUploadLogic();
  }

  // ---- UPLOAD LOGIC (runs only after injection) ----
  function initUploadLogic() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const statusEl = document.getElementById('status');
    const downloadBtn = document.getElementById('downloadBtn');
    const progressBar = document.getElementById('progressBar');
    const progressFill = progressBar.querySelector('.progress-fill');
    const progressText = document.getElementById('progressText');
    const fileInfo = document.getElementById('fileInfo');
    const stepper = document.getElementById('stepper');

    function setStep(stepNumber) {
      for (let i = 1; i <= 4; i++) {
        const stepEl = document.getElementById('step' + i);
        const iconEl = stepEl.querySelector('.step-icon');
        stepEl.classList.remove('error');

        if (i < stepNumber) {
          stepEl.className = 'step completed';
          iconEl.innerHTML = '✓';
        } else if (i === stepNumber) {
          stepEl.className = 'step active';
          iconEl.innerHTML = '<span class="spinner-small"></span>';
        } else {
          stepEl.className = 'step';
          iconEl.innerHTML = i;
        }
      }
    }

    function setStepError() {
      const activeStep = document.querySelector('.step.active');
      if (activeStep) {
        activeStep.className = 'step error';
        activeStep.querySelector('.step-icon').innerHTML = '✗';
      }
    }

    dropZone.addEventListener('click', function () { fileInput.click(); });
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', function () { handleFile(fileInput.files[0]); });

    async function handleFile(file) {
      if (!file || !file.name.endsWith('.apk')) {
        showStatus('Please select a valid APK file', 'error');
        return;
      }

      var FILENAME_REGEX = /^[a-zA-Z0-9._\-]+\.apk$/;
      if (!FILENAME_REGEX.test(file.name)) {
        showStatus('Invalid filename. Only letters, numbers, dots, dashes, and underscores are allowed (no spaces).', 'error');
        return;
      }

      // Validate magic bytes (ZIP signature: PK\x03\x04)
      var headerBuf = await file.slice(0, 4).arrayBuffer();
      var headerView = new Uint8Array(headerBuf);
      if (headerView.length < 4 || headerView[0] !== 0x50 || headerView[1] !== 0x4B || headerView[2] !== 0x03 || headerView[3] !== 0x04) {
        showStatus('File does not appear to be a valid APK (invalid ZIP signature)', 'error');
        return;
      }

      var fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
      fileInfo.textContent = file.name + ' (' + fileSizeMB + ' MB)';
      fileInfo.classList.add('visible');

      downloadBtn.classList.remove('visible');
      progressBar.classList.add('visible');
      progressText.classList.add('visible');
      stepper.classList.add('visible');
      progressFill.style.width = '0%';
      progressText.textContent = '0%';

      try {
        setStep(1);
        showStatus('Creating release...', 'loading');

        var release = await workerFetch('create-release', 'POST',
          { tag_name: 'signing-' + Date.now(), name: 'Signing Job', draft: true }
        );
        if (!release.id) throw new Error('Failed to create release: ' + JSON.stringify(release));

        showStatus('Uploading APK (' + fileSizeMB + ' MB)...', 'loading');

        var asset = await uploadWithProgress(
          WORKER_URL + '?release_id=' + release.id + '&file_name=' + encodeURIComponent(file.name),
          file
        );
        if (!asset.id) throw new Error('Asset upload failed: ' + JSON.stringify(asset));

        setStep(2);
        showStatus('Triggering signing workflow...', 'loading');

        await workerFetch('trigger-workflow', 'POST', {
          apk_url: asset.url,
          file_name: file.name,
          release_id: String(release.id)
        });

        setStep(3);
        showStatus('Signing in progress...', 'loading');

        await pollForResult(release.id, file.name);

      } catch (err) {
        progressBar.classList.remove('visible');
        progressText.classList.remove('visible');
        setStepError();
        showStatus(err.message, 'error');
      }
    }

    async function pollForResult(releaseId, originalName) {
      var signedName = originalName.replace(/\.apk$/i, '_wpos_signed.apk');
      var maxAttempts = 120;
      var attempts = 0;

      return new Promise(function (resolve, reject) {
        var interval = setInterval(async function () {
          attempts++;
          if (attempts > maxAttempts) {
            clearInterval(interval);
            progressBar.classList.remove('visible');
            progressText.classList.remove('visible');
            reject(new Error('Timed out after 2 minutes. Check GitHub Actions for errors.'));
            return;
          }
          try {
            var assets = await workerFetch('poll-assets&release_id=' + releaseId, 'GET');
            var signed = assets.find(function (a) { return a.name === signedName; });
            if (signed) {
              clearInterval(interval);
              progressBar.classList.remove('visible');
              progressText.classList.remove('visible');
              setStep(5);
              showStatus('Signing complete! Ready to download.', 'success');

              // SECURITY: Download via fetch + Blob so passcode stays in headers only
              downloadBtn.onclick = async function () {
                downloadBtn.disabled = true;
                downloadBtn.textContent = '⏳ Downloading...';
                try {
                  var dlRes = await fetch(WORKER_URL + '?asset_url=' + encodeURIComponent(signed.url) + '&download_name=' + encodeURIComponent(signedName), {
                    headers: { 'X-Action': 'download-asset', 'X-Passcode': _verifiedPasscode }
                  });
                  if (!dlRes.ok) throw new Error('Download failed');
                  var blob = await dlRes.blob();
                  var blobUrl = URL.createObjectURL(blob);
                  var tempLink = document.createElement('a');
                  tempLink.href = blobUrl;
                  tempLink.download = signedName;
                  tempLink.click();
                  URL.revokeObjectURL(blobUrl);
                } catch (err) {
                  showStatus('Download failed: ' + err.message, 'error');
                }
                downloadBtn.disabled = false;
                downloadBtn.textContent = '⬇️ Download Signed APK';
              };

              downloadBtn.classList.add('visible');
              resolve();
            }
          } catch (e) { /* keep polling */ }
        }, 1000);
      });
    }

    // Uses the closure-scoped _verifiedPasscode
    function workerFetch(action, method, body) {
      var opts = {
        method: method || 'GET',
        headers: { 'X-Action': action, 'Content-Type': 'application/json', 'X-Passcode': _verifiedPasscode }
      };
      if (body) opts.body = JSON.stringify(body);
      return fetch(WORKER_URL, opts).then(function (r) {
        return r.json().then(function (json) {
          if (!r.ok) throw new Error(json.error || 'HTTP ' + r.status);
          return json;
        });
      });
    }

    function uploadWithProgress(url, file) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', function (e) {
          if (e.lengthComputable) {
            var progress = Math.round((e.loaded / e.total) * 100);
            progressFill.style.width = progress + '%';
            progressText.textContent = progress + '%';
          }
        });

        xhr.addEventListener('load', function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (e) {
              reject(new Error('Failed to parse upload response'));
            }
          } else {
            reject(new Error('Upload failed with status ' + xhr.status));
          }
        });

        xhr.addEventListener('error', function () { reject(new Error('Upload error')); });
        xhr.addEventListener('abort', function () { reject(new Error('Upload cancelled')); });

        xhr.open('POST', url);
        xhr.setRequestHeader('X-Action', 'upload-asset');
        xhr.setRequestHeader('X-Passcode', _verifiedPasscode);
        xhr.send(file);
      });
    }

    function showStatus(msg, type) {
      type = type || 'loading';
      statusEl.innerHTML = '';
      var icon = '';
      if (type === 'loading') {
        var spinner = document.createElement('span');
        spinner.className = 'spinner';
        statusEl.appendChild(spinner);
      } else if (type === 'error') {
        icon = '⚠️';
      } else if (type === 'success') {
        icon = '✅';
      }
      var textNode = document.createTextNode((icon ? icon + ' ' : '') + msg);
      statusEl.appendChild(textNode);
      statusEl.className = 'status visible ' + type;
    }
  }
})();
