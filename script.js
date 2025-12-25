// ==========================================
// 1. Firebase 引入與初始化 (Module 模式)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore, collection, addDoc, query, where, orderBy, onSnapshot,
    doc, setDoc, updateDoc, increment, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
// 【請在此處貼上 Firebase Config】
// ⚠️ 如果你剛才貼過真實金鑰，請確保這裡是你正確的金鑰資料
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

const firebaseConfig = {
    apiKey: "AIzaSyCpnd4DLvrG1I71Bl98MvTIfEV_M6Pt3mg",
    authDomain: "shadowverse-wb.firebaseapp.com",
    projectId: "shadowverse-wb",
    storageBucket: "shadowverse-wb.firebasestorage.app",
    messagingSenderId: "865607717090",
    appId: "1:865607717090:web:86c40f5d55d09a25dd0ebb",
    measurementId: "G-XKPCMQHLP6"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// 全域變數：紀錄當前使用者與狀態
let currentUser = null;
let currentHistoryDeck = null;
let currentWeeklyDeck = null;
let unsubscribeComments = null; // 用來取消監聽留言
let voteChart = null; // 投票圖表實例

// ==========================================
// 2. 使用者登入/登出邏輯 (掛載到 window)
// ==========================================
window.toggleSignIn = () => {
    if (currentUser) {
        signOut(auth).then(() => alert("已登出"));
    } else {
        signInWithPopup(auth, provider).catch((error) => {
            console.error("登入失敗", error);
            alert("登入失敗：" + error.message);
        });
    }
};

// 監聽登入狀態改變
onAuthStateChanged(auth, (user) => {
    currentUser = user;

    // 取得 UI 元件
    const authBtn = document.getElementById('auth-btn');
    const userDisplay = document.getElementById('user-display');
    const commentInput = document.getElementById('comment-input');
    const sendBtn = document.getElementById('send-comment-btn');
    const voteBtn = document.getElementById('vote-btn');

    // 確保元件存在才執行 (避免報錯)
    if (!authBtn) return;

    if (user) {
        // 登入後狀態
        authBtn.textContent = "登出";
        if (userDisplay) {
            userDisplay.textContent = `Hi, ${user.displayName}`;
            userDisplay.style.display = "inline";
        }

        // 解鎖輸入框與按鈕
        if (commentInput) {
            commentInput.disabled = false;
            commentInput.placeholder = "分享你的戰術心得...";
        }
        if (sendBtn) sendBtn.disabled = false;

        // 重新檢查投票狀態
        if (currentWeeklyDeck) checkVoteStatus(currentWeeklyDeck);

    } else {
        // 登出後狀態
        authBtn.textContent = "登入 / 註冊";
        if (userDisplay) userDisplay.style.display = "none";

        // 鎖定功能
        if (commentInput) {
            commentInput.disabled = true;
            commentInput.placeholder = "請先登入以發表留言";
        }
        if (sendBtn) sendBtn.disabled = true;
        if (voteBtn) {
            voteBtn.disabled = true;
            voteBtn.textContent = "請先登入以投票";
        }
    }
});

// ==========================================
// 3. 歷史牌組：留言板功能 (★已修正 Debug)
// ==========================================
function loadComments(deckName) {
    currentHistoryDeck = deckName;
    const deckNameDisplay = document.getElementById('comment-deck-name');

    // ★★★ 修正 1：使用 innerHTML 解析 <br> 標籤 ★★★
    if (deckNameDisplay) deckNameDisplay.innerHTML = deckName;

    const list = document.getElementById('comments-list');
    if (!list) return;

    list.innerHTML = '<p style="color:#888; padding:10px;">載入中...</p>';

    // 如果之前有監聽，先取消
    if (unsubscribeComments) unsubscribeComments();

    // ★★★ 修正 2：移除 orderBy，改用 JS 排序 ★★★
    // 原因：Firebase 同時用 where 和 orderBy 需要手動建立索引，容易造成新手卡在載入中。
    // 我們先只篩選牌組，抓回來後再用程式碼排順序。
    const q = query(collection(db, "comments"), where("deckName", "==", deckName));

    // 啟用即時監聽
    unsubscribeComments = onSnapshot(q, (snapshot) => {
        list.innerHTML = "";
        if (snapshot.empty) {
            list.innerHTML = '<p style="color:#666; padding:10px;">目前沒有留言，搶頭香！</p>';
            return;
        }

        // 將資料轉為陣列並手動排序 (新到舊)
        let commentsArray = [];
        snapshot.forEach((doc) => {
            commentsArray.push(doc.data());
        });

        // 根據 timestamp 排序 (新的在前)
        commentsArray.sort((a, b) => {
            // 防止 timestamp 為 null (剛寫入時可能會有延遲)
            const timeA = a.timestamp ? a.timestamp.toDate().getTime() : Date.now();
            const timeB = b.timestamp ? b.timestamp.toDate().getTime() : Date.now();
            return timeB - timeA;
        });

        // 渲染畫面
        commentsArray.forEach((data) => {
            const date = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleString() : "剛剛";

            const row = document.createElement('div');
            row.className = 'comment-row';
            row.innerHTML = `
                <div>
                    <span class="comment-user">${data.userName}</span>
                    <span class="comment-time">${date}</span>
                </div>
                <div class="comment-content">${data.content}</div>
            `;
            list.appendChild(row);
        });
    }, (error) => {
        // ★★★ 修正 3：加入錯誤處理，讓你知道為什麼失敗 ★★★
        console.error("載入留言失敗:", error);
        list.innerHTML = `<p style="color:#ff6b6b; padding:10px;">載入失敗: ${error.message}<br>請檢查 Console (F12)</p>`;
    });
}

// 發布留言 (掛載到 window)
window.postComment = async () => {
    const input = document.getElementById('comment-input');
    const content = input.value.trim();
    if (!content || !currentUser || !currentHistoryDeck) return;

    try {
        await addDoc(collection(db, "comments"), {
            deckName: currentHistoryDeck,
            userId: currentUser.uid,
            userName: currentUser.displayName,
            content: content,
            timestamp: new Date() // 使用 Client 時間方便即時顯示
        });
        input.value = ""; // 清空
    } catch (e) {
        console.error("留言失敗", e);
        alert("留言失敗：" + e.message);
    }
};

// ==========================================
// 4. 本週熱門：投票系統 (已更新：總票數統計)
// ==========================================
let unsubscribeVoteChart = null; // 新增：用來管理圖表監聽器的變數

function initVoteChart() {
    const ctx = document.getElementById('voteChart');
    if (!ctx) return;

    if (voteChart) voteChart.destroy();

    voteChart = new Chart(ctx, {
        type: 'bar',
        data: {
            // ★ 修改標籤：顯示總投票數
            labels: ['當前牌組', '網站總投票數'],
            datasets: [{
                label: '得票數',
                data: [0, 0], // 初始值
                // 設定不同顏色方便區分：金色代表當前，深灰代表總數
                backgroundColor: ['#D4AF37', '#444'],
                borderColor: ['#D4AF37', '#666'],
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            scales: { x: { beginAtZero: true, grid: { color: '#333' } } },
            plugins: { legend: { display: false } }
        }
    });
}

function loadVotes(deckKey, deckTitle) {
    currentWeeklyDeck = deckKey;
    const nameDisplay = document.getElementById('vote-deck-name');
    if (nameDisplay) nameDisplay.textContent = deckTitle;

    // ★★★ 重點修改：監聽整個集合，而非單一文件 ★★★
    // 這樣才能算出所有牌組的總票數
    const votesCollection = collection(db, "weekly_votes");

    // 如果之前有正在監聽的，先取消，避免重複執行浪費效能
    if (unsubscribeVoteChart) unsubscribeVoteChart();

    unsubscribeVoteChart = onSnapshot(votesCollection, (snapshot) => {
        let totalVotes = 0;
        let currentDeckVotes = 0;

        // 遍歷所有投票文件來計算總和
        snapshot.forEach(doc => {
            const data = doc.data();
            const count = data.count || 0;

            // 累加總票數
            totalVotes += count;

            // 如果是當前瀏覽的牌組，記錄它的票數
            if (doc.id === deckKey) {
                currentDeckVotes = count;
            }
        });

        // 更新文字數字顯示
        const countDisplay = document.getElementById('vote-count-display');
        if (countDisplay) countDisplay.textContent = currentDeckVotes;

        // 更新圖表數據 [當前, 總數]
        if (voteChart) {
            voteChart.data.datasets[0].data = [currentDeckVotes, totalVotes];
            voteChart.update();
        }
    });

    // 檢查按鈕狀態 (這部分維持不變)
    checkVoteStatus(deckKey);
}

async function checkVoteStatus(deckKey) {
    const btn = document.getElementById('vote-btn');
    const msg = document.getElementById('vote-msg');

    if (!btn) return;

    if (!currentUser) {
        btn.disabled = true;
        btn.textContent = "請先登入";
        if (msg) msg.textContent = "";
        return;
    }

    const voteRecordRef = doc(db, "weekly_votes", deckKey, "voters", currentUser.uid);
    const snap = await getDoc(voteRecordRef);

    if (snap.exists()) {
        btn.disabled = true;
        btn.textContent = "已投票";
        btn.style.background = "#555";
        btn.style.boxShadow = "none";
        if (msg) msg.textContent = "感謝您的支持！";
    } else {
        btn.disabled = false;
        btn.textContent = "投給這一套";
        btn.style.background = "linear-gradient(45deg, #D4AF37, #FDC830)";
        if (msg) msg.textContent = "";
    }
}

// 執行投票 (掛載到 window)
window.castVote = async () => {
    if (!currentUser || !currentWeeklyDeck) return;

    const deckRef = doc(db, "weekly_votes", currentWeeklyDeck);
    const userVoteRef = doc(db, "weekly_votes", currentWeeklyDeck, "voters", currentUser.uid);

    try {
        await setDoc(userVoteRef, { votedAt: new Date() });
        // merge: true 確保如果文件不存在會自動建立
        await setDoc(deckRef, { count: increment(1) }, { merge: true });

        // UI 會透過 onSnapshot 自動更新，這裡只需要檢查按鈕狀態
        checkVoteStatus(currentWeeklyDeck);
    } catch (e) {
        console.error("投票失敗", e);
        alert("投票發生錯誤");
    }
};

// ==========================================
// 5. YouTube API 背景影片控制
// ==========================================
// 由於使用了 type="module"，原本的全域變數與函數需要手動掛載到 window

var player;
var isIntroDone = false;

// 1. 載入 YouTube IFrame Player API 代碼
var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// 2. 當 API 準備好時，建立播放器 (掛載到 window)
window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
        videoId: 'vWbDEsDbXBA', // 你的影片 ID
        playerVars: {
            'autoplay': 0,
            'controls': 0,
            'rel': 0,
            'loop': 0,
            'playsinline': 1,
            'disablekb': 1,
            'origin': window.location.origin,
            'enablejsapi': 1,
            'modestbranding': 1,
            'iv_load_policy': 3
        },
        events: {
            'onStateChange': onPlayerStateChange,
            'onReady': onPlayerReady
        }
    });
}

function onPlayerReady(event) {
    const loader = document.getElementById('loader-screen');
    loader.style.opacity = '0';
    setTimeout(() => {
        loader.style.display = 'none';
    }, 500);

    const startOverlay = document.getElementById('start-overlay');
    startOverlay.style.display = 'flex';

    player.mute();
}
// 確保內部調用也能抓到
window.onPlayerReady = onPlayerReady;

// 3. 使用者點擊 "ENTER SITE" 後觸發 (掛載到 window)
window.startExperience = function () {
    document.getElementById('start-overlay').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('start-overlay').style.display = 'none';
    }, 500);

    if (player && player.playVideo) {
        player.unMute();
        player.setVolume(50);
        player.playVideo();

        document.getElementById('volume-control-panel').style.display = 'flex';

        checkIntroTime();
    }
}

// 4. 監控時間
function checkIntroTime() {
    var checkInterval = setInterval(function () {
        if (!player || !player.getCurrentTime) return;

        var currentTime = player.getCurrentTime();

        if (currentTime > 4 && !isIntroDone) {
            isIntroDone = true;
            document.querySelector('.video-background').classList.add('faded');
            player.getIframe().style.opacity = "";
            document.getElementById('main-hero-content').classList.add('visible');
            document.getElementById('site-header').classList.remove('nav-hidden');
            document.getElementById('site-header').classList.add('nav-visible');

            clearInterval(checkInterval);
        }
    }, 500);
}

// 5. 狀態改變監聽
function onPlayerStateChange(event) {
    var iframe = player.getIframe();
    if (event.data === YT.PlayerState.ENDED) {
        iframe.style.transition = 'none';
        iframe.style.opacity = 0;
        setTimeout(function () {
            player.seekTo(0);
            player.playVideo();
        }, 5000);
    }

    if (event.data === YT.PlayerState.PLAYING) {
        iframe.style.transition = 'opacity 2s ease';
        iframe.style.opacity = "";
    }
}

// 6. 音量滑桿控制 (掛載到 window)
window.toggleVolumePanel = function () {
    const panel = document.getElementById('volume-control-panel');
    panel.classList.toggle('active');
}

window.changeVolume = function (vol) {
    if (player) {
        player.setVolume(vol);
        const icon = document.getElementById('volume-icon');
        if (vol == 0) {
            icon.innerHTML = '🔇';
        } else {
            icon.innerHTML = '🔊';
        }
    }
}

// 7. 快速靜音 (掛載到 window)
window.toggleMute = function () {
    var slider = document.getElementById('volume-slider');
    if (player.isMuted()) {
        player.unMute();
        player.setVolume(slider.value);
        document.getElementById('volume-icon').innerHTML = '🔊';
    } else {
        player.mute();
        document.getElementById('volume-icon').innerHTML = '🔇';
    }
}


// ==========================================
// 6. 頁面切換邏輯 (SPA Navigation)
// ==========================================
window.switchPage = function (pageId) {
    document.querySelectorAll('.page-section').forEach(section => {
        section.classList.add('hidden');
    });

    const targetSection = document.getElementById('section-' + pageId);
    if (targetSection) {
        targetSection.classList.remove('hidden');
    }

    document.querySelectorAll('.nav-links a').forEach(link => {
        link.classList.remove('active');
    });

    const activeNav = document.getElementById('nav-' + pageId);
    if (activeNav) {
        activeNav.classList.add('active');
    }
}

// ==========================================
// 7. 卡片資料庫 (Cards Data)
// ==========================================
const cardsData = [
    { id: 1, name: "冒險精靈‧小梅", class: "elf", cost: 1, atk: "1", hp: "1", image: "images/el1-1-1.png", desc: "【入場曲】【連擊_3】指定1張敵方戰場上的從者卡。給予其3點傷害。" },
    { id: 2, name: "純真的水之妖精", class: "elf", cost: 1, atk: "1", hp: "1", image: "images/el1-1-2.png", desc: "【謝幕曲】增加1張『妖精』到自己的手牌中。" },
    { id: 3, name: "群蟲惡兆", class: "elf", cost: 1, atk: "N/A", hp: "N/A", image: "images/el1-1-3.png", desc: "指定1張自己戰場上的卡片。使其返回手牌中。隨機給予1張敵方戰場上的從者卡2點傷害。" },
    { id: 4, name: "召集妖精", class: "elf", cost: 1, atk: "N/A", hp: "N/A", image: "images/el1-1-4.png", desc: "增加2張『妖精』到自己的手牌中。" },
    { id: 5, name: "來自樹上的突襲", class: "elf", cost: 1, atk: "N/A", hp: "N/A", image: "images/el1-1-5.png", desc: "發動1次「隨機給予1張敵方戰場上的從者卡2點傷害」。【連擊_3】由原本的1次轉變為2次。" },
    { id: 6, name: "驅逐的死箭", class: "elf", cost: 1, atk: "N/A", hp: "N/A", image: "images/el1-1-6.png", desc: "發動X次「隨機使1張敵方戰場上的從者卡-0/-1」。X為「自己的【連擊】數」。" },
    { id: 7, name: "綺羅星", class: "elf", cost: 1, atk: "N/A", hp: "N/A", image: "images/el1-2-1.png", desc: "隨機給予1張敵方戰場上的從者卡2點傷害。【連擊_5】使自己獲得『紋章：綺羅星』。<br>紋章<br>【倒數_1】<br>【謝幕曲】給予敵方的主戰者1點傷害。增加1張『綺羅星』到自己的手牌中。" },
    { id: 8, name: "妖精馴服者", class: "elf", cost: 2, atk: "1", hp: "1", image: "images/el1-2-2.png", desc: "【入場曲】增加2張『妖精』到自己的手牌中。" },
    { id: 9, name: "獨行的獸人", class: "elf", cost: 2, atk: "2", hp: "2", image: "images/el1-2-3.png", desc: "【入場曲】使自己的【連擊】+1。" },
    { id: 10, name: "舞動的妖精", class: "elf", cost: 2, atk: "2", hp: "1", image: "images/el1-2-4.png", desc: "【入場曲】【連擊_3】使自己戰場上全部的其他從者卡+1/+1。" },
    { id: 11, name: "幼年寶石獸", class: "elf", cost: 2, atk: "2", hp: "2", image: "images/el1-2-5.png", desc: "【入場曲】指定1張自己戰場上的其他卡片。使其返回手牌中。<br>【超進化時】回復自己的PP 3點。" },
    { id: 12, name: "純潔冰晶‧莉莉", class: "elf", cost: 2, atk: "1", hp: "3", image: "images/el1-2-6.png", desc: "【入場曲】【連擊_3】指定1張敵方戰場上的從者卡。使其生命值轉變為1。<br>【進化時】由自己的牌堆中抽取1張卡片。指定1張敵方戰場上的從者卡。給予其1點傷害。<br>" },
    { id: 13, name: "妖精劍客", class: "elf", cost: 2, atk: "2", hp: "2", image: "images/el1-3-1.png", desc: "於手牌中發動。當自己的從者卡超進化時，使這張卡片的消費轉變為1。<br>【入場曲】增加1張『妖精』到自己的手牌中。<br>" },
    { id: 14, name: "不弒的肯定者", class: "elf", cost: 2, atk: "2", hp: "2", image: "images/el1-3-2.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。使其-0/-1。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 15, name: "妖精劍的承襲者", class: "elf", cost: 2, atk: "1", hp: "3", image: "images/el1-3-3.png", desc: "當自己的妖精‧從者卡進入戰場時，使這張卡片+1/+0。" },
    { id: 16, name: "美妝少女‧庫蘿耶", class: "elf", cost: 2, atk: "2", hp: "2", image: "images/el1-3-4.png", desc: "【爆能強化_8】指定1張自己手牌中的從者卡。將其召喚到自己的戰場上。使這張卡片返回手牌中。" },
    { id: 17, name: "風之攝理‧伊維亞", class: "elf", cost: 2, atk: "2", hp: "1", image: "images/el1-3-5.png", desc: "【入場曲】【奧義】回復自己的EP 1點。<br>【突進】" },
    { id: 18, name: "花園的導引", class: "elf", cost: 2, atk: "N/A", hp: "N/A", image: "images/el1-3-6.png", desc: "【融合】精靈‧卡片<br>由自己的牌堆中抽取1張卡片。如果已有卡片與這張卡片進行【融合】，則會由原本的1張轉變為2張。" },
    { id: 19, name: "野性的猛襲", class: "elf", cost: 2, atk: "N/A", hp: "N/A", image: "images/el1-4-1.png", desc: "指定1張敵方戰場上的從者卡。給予其4點傷害。【連擊_3】由自己的牌堆中抽取1張卡片。" },
    { id: 20, name: "帚星", class: "elf", cost: 2, atk: "N/A", hp: "N/A", image: "images/el1-4-2.png", desc: "指定1張敵方戰場上的從者卡。給予其4點傷害。如果自己戰場上有已進化的從者卡，則會由自己的牌堆中抽取1張卡片。" },
    { id: 21, name: "精靈幻域", class: "elf", cost: 2, atk: "N/A", hp: "N/A", image: "images/el1-4-3.png", desc: "指定1個【模式】並發動該能力。【解放奧義】由原本的指定1個轉變為全部。<br>（1）由自己的牌堆中抽取1張卡片。回復自己的主戰者1點生命值。<br>（2）使自己戰場上全部的從者卡+1/+0並獲得【突進】。<br>（3）使自己戰場上全部的從者卡+0/+1並獲得【守護】。" },
    { id: 22, name: "絢綻之庭", class: "elf", cost: 2, atk: "N/A", hp: "N/A", image: "images/el1-4-4.png", desc: "【入場曲】增加1張『妖精』到自己的手牌中。<br>【倒數_2】<br>當自己的妖精‧從者卡進入戰場時，隨機給予1張敵方戰場上的從者卡1點傷害。" },
    { id: 23, name: "磷光輝岩", class: "elf", cost: 2, atk: "N/A", hp: "N/A", image: "images/el1-4-5.png", desc: "【入場曲】增加1張『妖精』到自己的手牌中。【連擊_3】增加1張『森林的奧祕』到自己的手牌中。<br>【策動】破壞這張卡片。指定1張自己戰場上的從者卡。使其+1/+1。" },
    { id: 24, name: "戀觸妖精", class: "elf", cost: 3, atk: "1", hp: "1", image: "images/el1-4-6.png", desc: "【入場曲】召喚1張『妖精』到自己的戰場上。增加1張『妖精』到自己的手牌中。<N/A>【進化時】發動與【入場曲】相同的能力。" },
    { id: 25, name: "勤勞的蚱蜢", class: "elf", cost: 3, atk: "2", hp: "1", image: "images/el1-5-1.png", desc: "【入場曲】由自己的牌堆中抽取1張消費為X的從者卡。X為「自己的【連擊】數」。" },
    { id: 26, name: "殺戮破魔蟲", class: "elf", cost: 3, atk: "0", hp: "2", image: "images/el1-5-2.png", desc: "【入場曲】使這張卡片+X/+0。X為「自己的【連擊】數」。<br>【疾馳】" },
    { id: 27, name: "新生劍師‧阿瑪茲", class: "elf", cost: 3, atk: "2", hp: "2", image: "images/el1-5-3.png", desc: "【入場曲】使這張卡片+X/+X。X為「自己手牌中的妖精‧從者卡張數」。<br>【守護】<br>【進化時】發動X次「隨機給予1張敵方戰場上的從者卡1點傷害」。X為「自己手牌中的妖精‧從者卡張數」。" },
    { id: 28, name: "野性少女", class: "elf", cost: 3, atk: "3", hp: "3", image: "images/el1-5-4.png", desc: "【突進】" },
    { id: 29, name: "薰交的敬慕", class: "elf", cost: 3, atk: "N/A", hp: "N/A", image: "images/el1-5-5.png", desc: "增加1張『森林的奧祕』到自己的手牌中。由自己的牌堆中抽取1張卡片。" },
    { id: 30, name: "聖樹權杖", class: "elf", cost: 3, atk: "N/A", hp: "N/A", image: "images/el1-5-6.png", desc: "自己的回合結束時，【連擊_3】由自己的牌堆中抽取1張卡片。<br>【策動】破壞這張卡片。指定1張自己戰場上的其他卡片。使其返回手牌中。" },
    { id: 31, name: "不弒之鄉", class: "elf", cost: 3, atk: "N/A", hp: "N/A", image: "images/el2-1-1.png", desc: "【入場曲】指定1張自己手牌中的卡片。將其捨棄。由自己的牌堆中抽取2張卡片。<br>【策動】破壞這張卡片。指定1張敵方戰場上的從者卡。使其-0/-2。<br>" },
    { id: 32, name: "溫厚的樹精", class: "elf", cost: 4, atk: "4", hp: "4", image: "images/el2-1-2.png", desc: "【入場曲】【連擊_3】使這張卡片進化。<br>【攻擊時】回復自己的主戰者2點生命值。" },
    { id: 33, name: "言傳的草人長老", class: "elf", cost: 4, atk: "3", hp: "3", image: "images/el2-1-3.png", desc: "入場曲】隨機給予1張敵方戰場上的從者卡3點傷害。【連擊_3】由原本的1張轉變為3張。" },
    { id: 34, name: "森林的騎士精神‧辛西亞", class: "elf", cost: 4, atk: "3", hp: "3", image: "images/el2-1-4.png", desc: "【入場曲】召喚2張『妖精』到自己的戰場上。<br>【進化時】使自己戰場上全部的妖精‧從者卡+1/+0。" },
    { id: 35, name: "羽翅女王‧提泰妮婭", class: "elf", cost: 4, atk: "2", hp: "2", image: "images/el2-1-5.png", desc: "【入場曲】召喚1張『妖精』到自己的戰場上。使自己獲得『紋章：羽翅女王‧提泰妮婭』。<br>【進化時】指定1張敵方戰場上的從者卡。使其變身為『妖精』。<br>紋章<br>自己的回合開始時，增加1張『妖精』到自己的手牌中。" },
    { id: 36, name: "樹海的戰士", class: "elf", cost: 4, atk: "4", hp: "4", image: "images/el2-1-6.png", desc: "【謝幕曲】增加1張『森林的奧祕』與1張『妖精』到自己的手牌中。" },
    { id: 37, name: "不弒的繼承者‧庫璐璐", class: "elf", cost: 4, atk: "1", hp: "3", image: "images/el2-2-1.png", desc: "【入場曲】使敵方戰場上全部的從者卡-0/-2。<br>【潛行】<br>當敵方從者卡的生命值在戰場上因「-」而減少時，每個自己的回合僅限發動1次，回復自己的主戰者1點生命值。<br>【超進化時】使敵方獲得『紋章：不弒的繼承者‧庫璐璐』。<br>紋章<br>【倒數_2】<br>當自己的從者卡進入戰場時，使其-1/-1。" },
    { id: 38, name: "可愛的花花甜心‧瑪娜麥莉", class: "elf", cost: 4, atk: "2", hp: "1", image: "images/el2-2-2.png", desc: "自己的回合結束時，使這張卡片進化。<br>當這張卡片進化時，給予敵方戰場上全部的從者卡1點傷害。" },
    { id: 39, name: "虹彩弓手‧庫比丹", class: "elf", cost: 4, atk: "3", hp: "2", image: "images/el2-2-3.png", desc: "【入場曲】【奧義】使這張卡片進化。【解放奧義】給予敵方的主戰者3點傷害。<br>當這張卡片進化時，發動7次「隨機給予1張敵方戰場上的從者卡1點傷害」。" },
    { id: 40, name: "薰交天宮‧巴克伍德", class: "elf", cost: 5, atk: "3", hp: "3", image: "images/el2-2-4.png", desc: "【入場曲】由自己的牌堆中抽取2張卡片。<br>【進化時】對敵方戰場上全部的從者卡分配X點傷害。X為「自己手牌中的卡片張數」。" },
    { id: 41, name: "木槌矮人", class: "elf", cost: 5, atk: "5", hp: "5", image: "images/el2-2-5.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。給予其4點傷害。【連擊_3】由原本的指定1張轉變為全部。" },
    { id: 42, name: "緋焰舞孃‧安絲璃雅", class: "elf", cost: 5, atk: "5", hp: "4", image: "images/el2-2-6.png", desc: "【入場曲】使自己戰場上全部的從者卡獲得【障壁】。" },
    { id: 43, name: "調和的舞者‧尤埃爾＆蘇希耶", class: "elf", cost: 5, atk: "4", hp: "3", image: "images/el2-3-1.png", desc: "【入場曲】發動2次「隨機給予1張敵方戰場上的從者卡4點傷害」。<br>【超進化時】使自己獲得『紋章：調和的舞者‧尤埃爾＆蘇希耶』。<br>紋章<br>【倒數_4】<br>當自己使用從者卡時，每個自己的回合僅限發動1次，使其進化。" },
    { id: 44, name: "自然界的妖精公主‧阿麗雅", class: "elf", cost: 6, atk: "4", hp: "4", image: "images/el2-3-2.png", desc: "【入場曲】使自己獲得『紋章：自然界的妖精公主‧阿麗雅』。<br>【超進化時】召喚3張『妖精』到自己的戰場上。<br>紋章<br>當自己的妖精‧從者卡進入戰場時，使其獲得【疾馳】。" },
    { id: 45, name: "狂熱精靈‧萊昂內爾", class: "elf", cost: 6, atk: "6", hp: "6", image: "images/el2-3-3.png", desc: "【入場曲】召喚2張『幼年寶石獸』到自己的戰場上。<br>【守護】" },
    { id: 46, name: "不弒的祈禱者", class: "elf", cost: 6, atk: "5", hp: "6", image: "images/el2-3-4.png", desc: "【入場曲】使敵方戰場上全部的從者卡-0/-3。<br>【超進化時】發動與【入場曲】相同的能力。" },
    { id: 47, name: "音速弓手‧塞爾文", class: "elf", cost: 7, atk: "4", hp: "6", image: "images/el2-3-5.png", desc: "【疾馳】<br>【超進化時】指定1張敵方戰場上的從者卡。使其返回手牌中。" },
    { id: 48, name: "寒霜冰晶‧艾琳", class: "elf", cost: 7, atk: "6", hp: "8", image: "images/el2-3-6.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。將其破壞。回復自己的主戰者2點生命值。<br>【守護】" },
    { id: 49, name: "纏枝密林‧麗梅格", class: "elf", cost: 7, atk: "7", hp: "7", image: "images/el2-4-1.png", desc: "【入場曲】指定2張敵方戰場上的從者卡。到敵方的回合結束為止，使其獲得「無法攻擊從者或主戰者」。<br>【超進化時】指定2張敵方戰場上的從者卡。使其獲得「回合結束時，給予自己的主戰者1點傷害。給予這張卡片2點傷害」。" },
    { id: 50, name: "愛憎的舞者‧剛＆容", class: "elf", cost: 7, atk: "8", hp: "6", image: "images/el2-4-2.png", desc: "1回合中可進行2次攻擊。<br>【攻擊時】回復自己戰場上全部的從者卡與自己的主戰者3點生命值。" },
    { id: 51, name: "森林的行進", class: "elf", cost: 7, atk: "N/A", hp: "N/A", image: "images/el2-4-3.png", desc: "召喚3張『溫厚的樹精』到自己的戰場上。" },
    { id: 52, name: "深奧的妖精守護聖獸", class: "elf", cost: 8, atk: "4", hp: "4", image: "images/el2-4-4.png", desc: "【入場曲】由自己的牌堆中抽取1張卡片。回復自己的主戰者X點生命值。X為「自己手牌中的卡片張數」。" },
    { id: 53, name: "煌擊戰士‧貝魯", class: "elf", cost: 8, atk: "4", hp: "4", image: "images/el2-4-5.png", desc: "於手牌中發動。當自己的從者卡離開戰場時，使這張卡片的消費-1。<br>【入場曲】指定1張敵方戰場上的從者卡。給予其4點傷害。" },
    { id: 54, name: "絕命的顯現‧艾茲迪亞", class: "elf", cost: 8, atk: "6", hp: "6", image: "images/el2-4-6.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。使其-0/-6。<br>【進化時】增加1張『絕命的痛擊』到自己的手牌中。" },
    { id: 55, name: "豔麗的玫瑰皇后", class: "elf", cost: 9, atk: "6", hp: "6", image: "images/el2-5-1.png", desc: "【入場曲】使自己手牌中消費為2以下的全部精靈‧卡片變身為『薔薇的閃擊』。<br>【守護】<br>1回合中可進行2次攻擊。" },
    { id: 56, name: "不弒的團結者", class: "elf", cost: 9, atk: "4", hp: "6", image: "images/el2-5-2.png", desc: "當這張卡片進入戰場時，將這張卡片複製1張並召喚到自己的戰場上。使其-0/-1。<br>【突進】<br>【守護】" },


    { id: 57, name: "迅捷劍士", class: "royal", cost: 1, atk: "1", hp: "1", image: "images/ro1-1-1.png", desc: "【疾馳】" },
    { id: 58, name: "魯米那斯騎士", class: "royal", cost: 1, atk: "1", hp: "1", image: "images/ro1-1-2.png", desc: "當自己的士兵‧從者卡進入戰場時，到回合結束為止，使這張卡片+1/+0。<br>【進化時】召喚1張『騎士』到自己的戰場上。" },
    { id: 59, name: "奉還的劍閃", class: "royal", cost: 1, atk: "N/A", hp: "N/A", image: "images/ro1-1-3.png", desc: "【融合】財寶‧卡片<br>隨機給予1張敵方戰場上的從者卡2點傷害。增加1張『黃金短劍』到自己的手牌中。如果已有卡片與這張卡片進行【融合】，則會由自己的牌堆中抽取1張卡片。" },
    { id: 60, name: "篡奪的據點", class: "royal", cost: 1, atk: "N/A", hp: "N/A", image: "images/ro1-1-4.png", desc: "【策動】破壞這張卡片。指定1個【模式】並發動該能力。<br>（1）增加1張『黃金短劍』與1張『黃金首飾』到自己的手牌中。<br>（2）增加1張『黃金之杯』與1張『黃金之靴』到自己的手牌中。" },
    { id: 61, name: "王室車夫", class: "royal", cost: 2, atk: "1", hp: "2", image: "images/ro1-1-5.png", desc: "【謝幕曲】召喚1張『騎士』到自己的戰場上。" },
    { id: 62, name: "異端武士", class: "royal", cost: 2, atk: "2", hp: "1", image: "images/ro1-1-6.png", desc: "【入場曲】如果為已超進化解禁的回合，則會使這張卡片獲得【必殺】。<br>【突進】" },
    { id: 63, name: "魯米那斯槍士", class: "royal", cost: 2, atk: "1", hp: "2", image: "images/ro1-2-1.png", desc: "【入場曲】召喚1張『騎士』到自己的戰場上。<br>當自己的士兵‧從者卡進入戰場時，使其獲得【突進】。" },
    { id: 64, name: "忍者鼯鼠", class: "royal", cost: 2, atk: "2", hp: "1", image: "images/ro1-2-2.png", desc: "【潛行】<br>【進化時】召喚1張『忍者鼯鼠』到自己的戰場上。<br> " },
    { id: 65, name: "扳機女僕‧賽莉亞", class: "royal", cost: 2, atk: "2", hp: "1", image: "images/ro1-2-3.png", desc: "【入場曲】隨機給予2張敵方戰場上的從者卡1點傷害。" },
    { id: 66, name: "休憩的王女‧普莉姆", class: "royal", cost: 2, atk: "1", hp: "1", image: "images/ro1-2-4.png", desc: "【入場曲】增加1張『沉穩的女僕‧諾嘉』到自己的手牌中。<br>【潛行】<br>【超進化時】使自己戰場上全部的其他從者卡+1/+1。" },
    { id: 67, name: "篡奪的肯定者", class: "royal", cost: 2, atk: "2", hp: "1", image: "images/ro1-2-5.png", desc: "【入場曲】增加1張『黃金之靴』到自己的手牌中。<br>【謝幕曲】增加1張『黃金之杯』到自己的手牌中。" },
    { id: 68, name: "篡奪的祈禱者", class: "royal", cost: 2, atk: "1", hp: "2", image: "images/ro1-2-6.png", desc: "【入場曲】增加1張『黃金首飾』到自己的手牌中。<br>【謝幕曲】增加1張『黃金短劍』到自己的手牌中。" },
    { id: 69, name: "信念的踢擊‧蘭德爾", class: "royal", cost: 2, atk: "3", hp: "2", image: "images/ro1-3-1.png", desc: "【爆能強化_5】使這張卡片獲得【疾馳】。" },
    { id: 70, name: "女僕的準則", class: "royal", cost: 2, atk: "N/A", hp: "N/A", image: "images/ro1-3-2.png", desc: "指定1張自己手牌中的卡片。使其返回牌堆中。由自己的牌堆中抽取2張皇家護衛‧從者卡。" },
    { id: 71, name: "達成協議", class: "royal", cost: 2, atk: "N/A", hp: "N/A", image: "images/ro1-3-3.png", desc: "由自己的牌堆中抽取2張卡片。使敵方由其牌堆中抽取1張卡片。" },
    { id: 72, name: "三將姬的亂擊", class: "royal", cost: 2, atk: "N/A", hp: "N/A", image: "images/ro1-3-4.png", desc: "隨機給予1張敵方戰場上的從者卡4點傷害。【爆能強化_4】由原本的1張轉變為3張。<br>" },
    { id: 73, name: "戰盾強擊", class: "royal", cost: 2, atk: "N/A", hp: "N/A", image: "images/ro1-3-5.png", desc: "指定1張自己戰場上的從者卡。使其獲得【守護】。隨機給予1張敵方戰場上的從者卡4點傷害。" },
    { id: 74, name: "魔煌詭智者‧拉斯提", class: "royal", cost: 3, atk: "3", hp: "3", image: "images/ro1-3-6.png", desc: "【超進化時】由自己的牌堆中抽取全部的『魔煌詭智者‧拉斯提』。使其獲得【疾馳】。" },
    { id: 75, name: "愛之騎士‧尹安", class: "royal", cost: 3, atk: "2", hp: "2", image: "images/ro1-4-1.png", desc: "【入場曲】指定1張自己戰場上的其他從者卡。使其+1/+1。<br>【守護】" },
    { id: 76, name: "救援的魯米那斯治療師‧琍菈菈", class: "royal", cost: 3, atk: "1", hp: "2", image: "images/ro1-4-2.png", desc: "【入場曲】召喚1張『鐵甲騎士』到自己的戰場上。<br>當自己的士兵‧從者卡進入戰場時，回復自己的主戰者1點生命值。" },
    { id: 77, name: "軍犬", class: "royal", cost: 3, atk: "4", hp: "2", image: "images/ro1-4-3.png", desc: "【爆能強化_6】召喚2張『軍犬』到自己的戰場上。<br>【突進】" },
    { id: 78, name: "寂靜狙擊手‧瓦路茲", class: "royal", cost: 3, atk: "2", hp: "1", image: "images/ro1-4-4.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。給予其5點傷害。<br>【爆能強化_6】使這張卡片+2/+2並獲得【潛行】。" },
    { id: 79, name: "備戰不息‧景光", class: "royal", cost: 3, atk: "2", hp: "2", image: "images/ro1-4-5.png", desc: "【謝幕曲】使自己獲得『紋章：備戰不息‧景光』。<br>【超進化時】使這張卡片獲得【疾馳】。<br>紋章<br>【倒數_2】<br>【謝幕曲】召喚1張『備戰不息‧景光』到自己的戰場上。" },
    { id: 80, name: "果敢的副團長‧格爾德", class: "royal", cost: 3, atk: "3", hp: "3", image: "images/ro1-4-6.png", desc: "【守護】<br>自己的回合結束時，如果自己戰場上有已超進化的從者卡，則會使自己戰場上全部的從者卡+1/+1。" },
    { id: 81, name: "瑰劍公主‧蘿婕", class: "royal", cost: 3, atk: "3", hp: "2", image: "images/ro1-5-1.png", desc: "【爆能強化_5】由自己的牌堆中抽取1張消費為2以下的皇家護衛‧從者卡。使其消費轉變為0。<br>【突進】<br>【攻擊時】如果對已受到傷害的從者卡進行攻擊，則會破壞交戰對象。" },
    { id: 82, name: "空絕的顯現‧歐克托莉斯", class: "royal", cost: 3, atk: "3", hp: "3", image: "images/ro1-5-2.png", desc: "【入場曲】使自己獲得『紋章：空絕的顯現‧歐克托莉斯』。<br>【進化時】增加1張『黃金短劍』與1張『黃金首飾』到自己的手牌中。<br>紋章<br>【倒數_8】<br>當自己使用財寶‧卡片時，或當自己將財寶‧卡片進行【融合】時，使這個紋章的倒數回合數-1。<br>【謝幕曲】增加1張『空絕的殘光』到自己的手牌中。" },
    { id: 83, name: "決意的輝龍‧亞瑟", class: "royal", cost: 3, atk: "2", hp: "3", image: "images/ro1-5-3.png", desc: "【守護】<br>【進化時】召喚1張『迷惘的獅子‧莫德雷德』到自己的戰場上。" },
    { id: 84, name: "迷惘的獅子‧莫德雷德", class: "royal", cost: 3, atk: "2", hp: "1", image: "images/ro1-5-4.png", desc: "【疾馳】<br>【進化時】召喚1張『決意的輝龍‧亞瑟』到自己的戰場上。" },
    { id: 85, name: "沸騰的鬥志‧費沙", class: "royal", cost: 3, atk: "5", hp: "4", image: "images/ro1-5-5.png", desc: "" },
    { id: 86, name: "王斷的威光", class: "royal", cost: 3, atk: "N/A", hp: "N/A", image: "images/ro1-5-6.png", desc: "指定1個【模式】並發動該能力。<br>（1）召喚1張『鐵甲騎士』與1張『騎士』到自己的戰場上。<br>（2）使自己戰場上全部的從者卡+1/+1。" },
    { id: 87, name: "戰鬥商販", class: "royal", cost: 4, atk: "3", hp: "2", image: "images/ro2-1-1.png", desc: "【突進】<br>【謝幕曲】由自己的牌堆中抽取1張卡片。" },
    { id: 88, name: "王斷天宮‧絲塔琪茉", class: "royal", cost: 4, atk: "4", hp: "4", image: "images/ro2-1-2.png", desc: "【進化時】召喚2張『騎士』到自己的戰場上。使自己戰場上全部的其他從者卡+1/+1。" },
    { id: 89, name: "平庸騎士‧拉奇爾", class: "royal", cost: 4, atk: "3", hp: "3", image: "images/ro2-1-3.png", desc: "【入場曲】由自己的牌堆中抽取1張法術卡。<br>【進化時】回復自己的PP 2點。" },
    { id: 90, name: "篡奪的團結者", class: "royal", cost: 4, atk: "3", hp: "3", image: "images/ro2-1-4.png", desc: "【入場曲】增加1張『黃金之杯』與1張『黃金之靴』到自己的手牌中。<br>當自己使用財寶‧卡片時，或當自己將財寶‧卡片進行【融合】時，隨機給予1張敵方戰場上的從者卡3點傷害。<br>【進化時】回復自己的PP 1點。" },
    { id: 91, name: "怒放的肌肉‧菲歐里", class: "royal", cost: 4, atk: "2", hp: "6", image: "images/ro2-1-5.png", desc: "【潛行】<br>【必殺】" },
    { id: 92, name: "鮮紅與群青‧瑟塔＆貝雅特麗絲", class: "royal", cost: 4, atk: "3", hp: "2", image: "images/ro2-1-6.png", desc: "【入場曲】召喚1張『鮮紅與群青‧瑟塔＆貝雅特麗絲』到自己的戰場上。<br>【爆能強化_6】使其獲得【必殺】。使這張卡片獲得【疾馳】<br>【突進】" },
    { id: 93, name: "十天眾頭目‧席耶提", class: "royal", cost: 4, atk: "4", hp: "3", image: "images/ro2-2-1.png", desc: "入場曲】【奧義】使自己戰場上全部進化前的從者卡進化。【解放奧義】由原本的進化轉變為超進化。" },
    { id: 94, name: "劍士的斬擊", class: "royal", cost: 4, atk: "0", hp: "0", image: "images/ro2-2-2.png", desc: "指定1張敵方戰場上的從者卡。將其破壞。召喚1張『鐵甲騎士』到自己的戰場上。" },
    { id: 95, name: "傳家皇冠", class: "royal", cost: 4, atk: "0", hp: "0", image: "images/ro2-2-3.png", desc: "【倒數_4】<br>當自己的從者卡進入戰場時，使其+1/+1。" },
    { id: 96, name: "卓越的魯米那斯法師", class: "royal", cost: 5, atk: "1", hp: "3", image: "images/ro2-2-4.png", desc: "【入場曲】召喚3張『鐵甲騎士』到自己的戰場上。<br>當自己的士兵‧從者卡進入戰場時，使其獲得【守護】。" },
    { id: 97, name: "雷維翁迅雷‧阿爾貝爾", class: "royal", cost: 5, atk: "3", hp: "5", image: "images/ro2-2-5.png", desc: "【爆能強化_9】給予敵方戰場上全部的從者卡3點傷害。使這張卡片獲得「1回合中可進行2次攻擊」。<br>【疾馳】" },
    { id: 98, name: "暗鬥的忍者大師", class: "royal", cost: 5, atk: "4", hp: "5", image: "images/ro2-2-6.png", desc: "【潛行】" },
    { id: 99, name: "開朗的偵察兵", class: "royal", cost: 5, atk: "3", hp: "3", image: "images/ro2-3-1.png", desc: "【入場曲】隨機將1張「自己牌堆中消費為3以下的皇家護衛‧從者卡」召喚到自己的戰場上。<br>【進化時】指定1張自己戰場上的其他從者卡。使其+2/+2。" },
    { id: 100, name: "英勇騎士的群集", class: "royal", cost: 5, atk: "N/A", hp: "N/A", image: "images/ro2-3-2.png", desc: "指定1個【模式】並發動該能力。<br>（1）使自己戰場上由左數來的1張皇家護衛‧從者卡獲得「1回合中可進行2次攻擊」。<br>（2）使自己戰場上全部的皇家護衛‧從者卡+1/+1並獲得【障壁】。<br>（3）回復自己的PP 2點。回復自己的EP 1點。<br>（4）回復自己的主戰者6點生命值。" },
    { id: 101, name: "和平商販‧艾爾涅絲塔", class: "royal", cost: 6, atk: "4", hp: "6", image: "images/ro2-3-3.png", desc: "【入場曲】使自己戰場上全部的其他從者卡+1/+1。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 102, name: "白銀騎士團長‧艾蜜莉亞", class: "royal", cost: 6, atk: "4", hp: "4", image: "images/ro2-3-4.png", desc: "【入場曲】由自己的牌堆中抽取2張皇家護衛‧從者卡。回復自己的PP 3點。<br>【超進化時】使自己戰場上全部的其他皇家護衛‧從者卡獲得【障壁】。" },
    { id: 103, name: "靜寂的弒滅者‧吉露塔利亞", class: "royal", cost: 6, atk: "4", hp: "4", image: "images/ro2-3-5.png", desc: "【入場曲】【協作_20】使這張卡片超進化。<br>當自己的其他從者卡進入戰場時，給予敵方戰場上全部的從者卡1點傷害。<br>當這張卡片進化時，召喚2張『鐵甲騎士』到自己的戰場上。使其獲得【突進】。" },
    { id: 104, name: "劍聖的同胞", class: "royal", cost: 6, atk: "5", hp: "5", image: "images/ro2-3-6.png", desc: "【謝幕曲】召喚1張『劍聖的同胞』到自己的戰場上。使其失去【謝幕曲】。" },
    { id: 105, name: "篡奪的繼承者‧辛士萊茲", class: "royal", cost: 6, atk: "5", hp: "6", image: "images/ro2-4-1.png", desc: "【融合】財寶‧卡片<br>【入場曲】給予敵方戰場上全部的從者卡與敵方的主戰者X點傷害。X為「與這張卡片【融合】的種類數」。<br>【超進化時】發動與【入場曲】相同的能力。" },
    { id: 106, name: "冰心霸王‧阿格羅瓦爾", class: "royal", cost: 6, atk: "5", hp: "3", image: "images/ro2-4-2.png", desc: "【入場曲】給予敵方戰場上全部的從者卡3點傷害。<br>【威懾】" },
    { id: 107, name: "雷維翁戰斧‧傑諾", class: "royal", cost: 7, atk: "7", hp: "6", image: "images/ro2-4-3.png", desc: "【突進】<br>1回合中可進行2次攻擊。<br>【攻擊時】使這張卡片獲得【障壁】。召喚1張『騎士』到自己的戰場上。" },
    { id: 108, name: "真王之刃‧黃金騎士", class: "royal", cost: 7, atk: "6", hp: "6", image: "images/ro2-4-4.png", desc: "【入場曲】指定1個【模式】並發動該能力。<br>（1）使這張卡片超進化。<br>（2）給予敵方戰場上全部的從者卡4點傷害。<br>（3）回復自己的主戰者4點生命值。<br>【爆能強化_9】由原本的指定1個轉變為全部。<br>" },
    { id: 109, name: "觸手咬擊", class: "royal", cost: 7, atk: "N/A", hp: "N/A", image: "images/ro2-4-5.png", desc: "指定1張敵方戰場上的從者卡或敵方的主戰者。給予其5點傷害。回復自己的主戰者5點生命值。" },
    { id: 110, name: "人馬騎士", class: "royal", cost: 8, atk: "7", hp: "5", image: "images/ro2-4-6.png", desc: "【疾馳】" },
    { id: 111, name: "煌刃勇者‧阿瑪莉雅", class: "royal", cost: 8, atk: "6", hp: "6", image: "images/ro2-5-1.png", desc: "【入場曲】召喚4張『鐵甲騎士』到自己的戰場上。<br>當自己的其他從者卡進入戰場時，使其+1/+0並獲得【突進】與【守護】。" },
    { id: 112, name: "雷維翁超凡者‧尤里烏斯", class: "royal", cost: 8, atk: "5", hp: "7", image: "images/ro2-5-2.png", desc: "【入場曲】召喚2張『騎士』到敵方的戰場上。<br>當敵方的從者卡進入戰場時，到敵方的回合結束為止，使其獲得「無法攻擊從者或主戰者」。給予敵方的主戰者1點傷害。回復自己的主戰者1點生命值。" },


    { id: 113, name: "遊歷四方的家庭教師‧蘇菲拉瑪", class: "witch", cost: 1, atk: "1", hp: "1", image: "images/wi1-2-1.png", desc: "自己的回合結束時，使自己手牌中全部的卡片發動X次魔力增幅。X為「這張卡片的攻擊力」。<br>【進化時】使這張卡片獲得「無法攻擊從者或主戰者」。" },
    { id: 114, name: "智慧耀光", class: "witch", cost: 1, atk: "N/A", hp: "N/A", image: "images/wi1-2-2.png", desc: "由自己的牌堆中抽取1張卡片。" },
    { id: 115, name: "暴風噴射", class: "witch", cost: 1, atk: "N/A", hp: "N/A", image: "images/wi1-2-3.png", desc: "X由2開始。<br>【魔力增幅時】使這張卡片的X+1。<br>指定1張敵方戰場上的從者卡。給予其X點傷害。" },
    { id: 116, name: "魔女的鍊金釜", class: "witch", cost: 1, atk: "N/A", hp: "N/A", image: "images/wi1-2-4.png", desc: "【入場曲】由自己的牌堆中抽取1張卡片。<br>【土之印】<br>消費1【策動】使自己戰場上的土之印+1。" },
    { id: 117, name: "見習占星術師", class: "witch", cost: 2, atk: "2", hp: "2", image: "images/wi1-2-5.png", desc: "【入場曲】指定1張自己手牌中的卡片。使其返回牌堆中。由自己的牌堆中抽取1張卡片。使自己戰場上的土之印+1。" },
    { id: 118, name: "嬌美教師‧米蘭", class: "witch", cost: 2, atk: "2", hp: "2", image: "images/wi1-2-6.png", desc: "【入場曲】使自己手牌中全部的卡片發動1次魔力增幅。<br>【進化時】指定1張敵方戰場上的從者卡。給予其3點傷害。使自己手牌中全部的卡片發動1次魔力增幅。" },
    { id: 119, name: "魔法藥劑師‧蓓妮露佩", class: "witch", cost: 2, atk: "2", hp: "2", image: "images/wi1-2-1.png", desc: "【入場曲】使自己戰場上的土之印+2。<br>【超進化時】由自己的牌堆中抽取2張卡片。回復自己的主戰者2點生命值。使自己戰場上的土之印+2。" },
    { id: 120, name: "憧憬的魔女‧梅薇", class: "witch", cost: 2, atk: "2", hp: "2", image: "images/wi1-2-2.png", desc: "【入場曲】增加1張『魔女的鍊金釜』到自己的手牌中。如果自己戰場上有已超進化的從者卡，則會使自己戰場上的土之印+2。" },
    { id: 121, name: "魔導圖書館員", class: "witch", cost: 2, atk: "2", hp: "2", image: "images/wi1-2-3.png", desc: "【入場曲】指定1張自己手牌中的卡片。使其返回牌堆中。由自己的牌堆中抽取1張法術卡。" },
    { id: 122, name: "真實的肯定者", class: "witch", cost: 2, atk: "2", hp: "2", image: "images/wi1-2-4.png", desc: "【入場曲】如果這張卡片的消費不為2，則會回復自己的主戰者3點生命值。" },
    { id: 123, name: "真實的繼承者‧薇赫里雅", class: "witch", cost: 2, atk: "2", hp: "2", image: "images/wi1-2-5.png", desc: "入場曲】由自己的牌堆中抽取1張卡片。<br>【進化時】指定1張敵方戰場上的從者卡。使其消失。<br>【超進化時】使敵方戰場上與其同名的全部從者卡消失。" },
    { id: 124, name: "召喚真理", class: "witch", cost: 2, atk: "N/A", hp: "N/A", image: "images/wi1-2-6.png", desc: "召喚1張『泥塵巨像』到自己的戰場上。" },
    { id: 125, name: "彩虹奇蹟", class: "witch", cost: 2, atk: "N/A", hp: "N/A", image: "images/wi1-3-1.png", desc: "指定1張自己手牌中擁有【魔力增幅時】的卡片。使其發動1次魔力增幅。由自己的牌堆中抽取1張卡片。" },
    { id: 126, name: "帕梅拉的舞蹈", class: "witch", cost: 2, atk: "N/A", hp: "N/A", image: "images/wi1-3-2.png", desc: "使自己戰場上的土之印+1。使自己獲得『紋章：帕梅拉的舞蹈』。<br>紋章<br>【倒數_1】<br>自己的回合結束時，由自己的牌堆中抽取1張卡片。【土之秘術_10】使自己戰場上全部的從者卡攻擊力/生命值轉變為2倍。" },
    { id: 127, name: "虛偽的術式", class: "witch", cost: 2, atk: "N/A", hp: "N/A", image: "images/wi1-3-3.png", desc: "指定1張自己手牌中的從者卡。使其消費+1。隨機破壞1張敵方戰場上的從者卡。" },
    { id: 128, name: "鍊金爆炎", class: "witch", cost: 2, atk: "N/A", hp: "N/A", image: "images/wi1-3-4.png", desc: "指定1張敵方戰場上的從者卡。給予其4點傷害。使自己戰場上的土之印+1。【奧義】給予敵方的主戰者2點傷害。" },
    { id: 129, name: "閃光之魔法劍士", class: "witch", cost: 3, atk: "2", hp: "2", image: "images/wi1-3-5.png", desc: "【入場曲】指定1個【模式】並發動該能力。<br>（1）使自己手牌中全部的卡片發動2次魔力增幅。<br>（2）【土之秘術_1】使這張卡片+2/+2並獲得【守護】。" },
    { id: 130, name: "智梟召喚師", class: "witch", cost: 3, atk: "3", hp: "3", image: "images/wi1-3-6.png", desc: "【入場曲】使自己戰場上的土之印+1。<br>【進化時】指定1張敵方戰場上的從者卡。給予其5點傷害。" },
    { id: 131, name: "馬納歷亞劍士‧歐文", class: "witch", cost: 3, atk: "3", hp: "3", image: "images/wi1-4-1.png", desc: "【守護】<br>【交戰時】使自己手牌中全部的卡片發動1次魔力增幅。<br>【進化時】由自己的牌堆中抽取2張從者卡。" },
    { id: 132, name: "真實的團結者", class: "witch", cost: 3, atk: "3", hp: "1", image: "images/wi1-4-2.png", desc: "【入場曲】如果這張卡片的消費不為3，則會將這張卡片複製2張並召喚到自己的戰場上。<br>【突進】<br>【超進化時】將這張卡片複製1張並召喚到自己的戰場上。" },
    { id: 133, name: "不可思議的哲學家‧費洛索菲亞", class: "witch", cost: 3, atk: "1", hp: "4", image: "images/wi1-4-3.png", desc: "【入場曲】由自己的牌堆中抽取1張法術卡。" },
    { id: 134, name: "懷舊的送火‧艾爾蒙特", class: "witch", cost: 3, atk: "", hp: "", image: "images/wi1-4-4.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。使其失去全部能力。給予其3點傷害。<br>【超進化時】使自己獲得『紋章：懷舊的送火‧艾爾蒙特』。<br>紋章<br>自己的回合開始時，給予敵方的主戰者1點傷害。" },
    { id: 135, name: "水之攝理‧瓦姆杜斯", class: "witch", cost: 3, atk: "0", hp: "1", image: "images/wi1-4-5.png", desc: "【魔力增幅時】使這張卡片+1/+1。<br>【入場曲】使自己手牌中全部的卡片發動1次魔力增幅。<br>【超進化時】指定1個【模式】並發動該能力。<br>（1）使自己戰場上全部的其他從者卡獲得【障壁】。<br>（2）對敵方戰場上全部的從者卡分配X點傷害。X為「這張卡片的攻擊力」。" },
    { id: 136, name: "理光的證明", class: "witch", cost: 3, atk: "N/A", hp: "N/A", image: "images/wi1-4-6.png", desc: "指定1個【模式】並發動該能力。<br>（1）使自己戰場上的土之印+4。<br>（2）回復自己的主戰者4點生命值。<br>（3）【土之秘術_3】給予敵方戰場上全部的從者卡4點傷害。" },
    { id: 137, name: "要完成課題！", class: "witch", cost: 3, atk: "N/A", hp: "N/A", image: "images/wi1-5-1.png", desc: "X由0開始。<br>【魔力增幅時】使這張卡片的X+1。隨後，如果X為5以上，則會使這張卡片變身為『有所成長了！』。<br>由自己的牌堆中抽取2張卡片。" },
    { id: 138, name: "", class: "witch", cost: 3, atk: "N/A", hp: "N/A", image: "images/wi1-5-2.png", desc: "X由0開始。<br>【魔力增幅時】使這張卡片的X+1。<br>對敵方戰場上全部的從者卡分配X點傷害。" },
    { id: 139, name: "真實的研究設施", class: "witch", cost: 3, atk: "N/A", hp: "N/A", image: "images/wi1-5-3.png", desc: "【倒數_5】<br>當自己使用消費有所變化的從者卡時，由自己的牌堆中抽取1張卡片。使這張卡片的倒數回合數-1。<br>【策動】指定1張自己手牌中的從者卡。使其消費+1。使其+1/+1。" },
    { id: 140, name: "雙貌魔女‧蕾米拉米", class: "witch", cost: 4, atk: "4", hp: "4", image: "images/wi1-5-4.png", desc: "【入場曲】【土之秘術_1】召喚1張『守護者巨像』到自己的戰場上。<br>【超進化時】指定1張自己戰場上的巨像‧從者卡。使其進化。使其+3/+3。" },
    { id: 141, name: "追夢的企鵝魔法師", class: "witch", cost: 4, atk: "2", hp: "2", image: "images/wi1-5-5.png", desc: "【入場曲】由自己的牌堆中抽取2張卡片。<br>【進化時】使自己手牌中全部的卡片發動2次魔力增幅。" },
    { id: 142, name: "理光天宮‧愛蒂倫瓦思", class: "witch", cost: 4, atk: "4", hp: "4", image: "images/wi1-5-6.png", desc: "【入場曲】【土之秘術_2】使這張卡片進化。<br>當這張卡片進化時，隨機給予1張敵方戰場上的從者卡4點傷害。回復自己的PP 2點。" },
    { id: 143, name: "調香魔法師", class: "witch", cost: 4, atk: "3", hp: "3", image: "images/wi2-1-1.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。給予其3點傷害。使自己戰場上的土之印+1。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 144, name: "五行的修行者", class: "witch", cost: 4, atk: "3", hp: "3", image: "images/wi2-1-2.png", desc: "【入場曲】召喚1張『式神‧小紙人』到自己的戰場上。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 145, name: "天才美少女鍊金術師‧卡莉歐斯托蘿", class: "witch", cost: 4, atk: "5", hp: "3", image: "images/wi2-1-3.png", desc: "【入場曲】使自己戰場上的土之印+2。增加1張『魔創鍊金』到自己的手牌中。【奧義】使這張卡片進化。【解放奧義】使自己獲得『紋章：天才美少女鍊金術師‧卡莉歐斯托蘿』。<br>紋章<br>自己的回合開始時，【土之秘術_1】增加1張『魔創鍊金』到自己的手牌中。" },
    { id: 146, name: "爆裂魔法", class: "witch", cost: 4, atk: "N/A", hp: "N/A", image: "images/wi2-1-4.png", desc: "給予戰場上全部的從者卡2點傷害。【土之秘術_1】由自己的牌堆中抽取1張卡片。" },
    { id: 147, name: "冰錐穿擊", class: "witch", cost: 4, atk: "N/A", hp: "N/A", image: "images/wi2-1-5.png", desc: "指定1張敵方戰場上的從者卡。將其破壞。【土之秘術_1】給予敵方的主戰者2點傷害。" },
    { id: 148, name: "水晶的預視", class: "witch", cost: 4, atk: "N/A", hp: "N/A", image: "images/wi2-1-6.png", desc: "使自己獲得『紋章：水晶的預視』。<br>紋章<br>【倒數_2】<br>【謝幕曲】由自己的牌堆中抽取2張卡片。給予敵方戰場上全部的從者卡4點傷害。" },
    { id: 149, name: "雙重創造", class: "witch", cost: 4, atk: "N/A", hp: "N/A", image: "images/wi2-2-1.png", desc: "召喚1張『守護者巨像』與1張『泥塵巨像』到自己的戰場上。" },
    { id: 150, name: "突破束縛", class: "witch", cost: 4, atk: "N/A", hp: "N/A", image: "images/wi2-2-2.png", desc: "指定1個【模式】並發動該能力。<br>（1）由自己的牌堆中抽取1張卡片。隨機給予1張敵方戰場上的從者卡4點傷害。<br>（2）由自己的牌堆中抽取2張卡片。隨機給予2張敵方戰場上的從者卡4點傷害。給予自己的主戰者2點傷害。" },
    { id: 151, name: "符文劍驅使者", class: "witch", cost: 5, atk: "1", hp: "1", image: "images/wi2-2-3.png", desc: "【魔力增幅時】使這張卡片+1/+1。<br>【入場曲】指定1張敵方戰場上的從者卡。給予其X點傷害。X為「這張卡片的攻擊力」。" },
    { id: 152, name: "驚奇女巫‧愛蜜兒", class: "witch", cost: 5, atk: "2", hp: "2", image: "images/wi2-2-4.png", desc: "【魔力增幅時】使這張卡片的消費-1。<br>【進化時】召喚1張『泥塵巨像』到自己的戰場上。給予敵方戰場上全部的從者卡X點傷害。X為「自己戰場上的巨像‧從者卡張數」。" },
    { id: 153, name: "拂曉鍊金術師‧諾諾", class: "witch", cost: 5, atk: "3", hp: "3", image: "images/wi2-2-5.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。給予其X點傷害。X為「自己戰場上的土之印數」。<br>【進化時】使自己獲得『紋章：拂曉鍊金術師‧諾諾』。<br>紋章<br>【倒數_3】<br>自己的回合結束時，【土之秘術_1】召喚1張『守護者巨像』到自己的戰場上。" },
    { id: 154, name: "馬納歷亞的親愛摯友‧安＆古蕾婭", class: "witch", cost: 5, atk: "4", hp: "4", image: "images/wi2-2-6.png", desc: "【入場曲】召喚1張『安的巨大英靈』到自己的戰場上。使自己手牌中全部的卡片發動3次魔力增幅。<br>【進化時】指定1張敵方戰場上的從者卡。給予其3點傷害。<br>" },
    { id: 155, name: "否定的詠唱‧芭賽特", class: "witch", cost: 5, atk: "4", hp: "4", image: "images/wi2-3-1.png", desc: "【入場曲】召喚2張『洋蔥軍團』到自己的戰場上。<br>【進化時】使自己獲得『紋章：否定的詠唱‧芭賽特』。<br>紋章<br>自己的回合開始時，召喚1張『洋蔥軍團』到自己的戰場上。" },
    { id: 156, name: "真實的祈禱者", class: "witch", cost: 5, atk: "3", hp: "2", image: "images/wi2-3-2.png", desc: "【入場曲】給予戰場上全部的其他從者卡3點傷害。如果這張卡片的消費不為5，則會由自己的牌堆中抽取2張卡片。" },
    { id: 157, name: "艱辛的旅程‧米蕾羽＆麗婕特", class: "witch", cost: 5, atk: "3", hp: "3", image: "images/wi2-3-3.png", desc: "【入場曲】召喚1張『艱辛的旅程‧米蕾羽＆麗婕特』到自己的戰場上。【土之秘術_2】使其與這張卡片進化。" },
    { id: 158, name: "馬納歷亞學子‧威廉", class: "witch", cost: 6, atk: "5", hp: "5", image: "images/wi2-3-4.png", desc: "X由0開始。<br>【魔力增幅時】使這張卡片的X+1。<br>【入場曲】給予敵方戰場上全部的從者卡X點傷害。<br>【進化時】使自己手牌中全部的卡片發動2次魔力增幅。" },
    { id: 159, name: "堅定的鍊金術師‧諾曼", class: "witch", cost: 6, atk: "5", hp: "5", image: "images/wi2-3-5.png", desc: "【入場曲】【土之秘術_1】指定1個【模式】並發動該能力。<br>\（1）召喚1張『守護者巨像』到自己的戰場上。使其獲得【障壁】。<br>（2）由自己的牌堆中抽取3張卡片。<br>（3）回復自己的主戰者4點生命值。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 160, name: "復仇的占卜師‧艾賽克萊因", class: "witch", cost: 6, atk: "6", hp: "5", image: "images/wi2-3-6.png", desc: "【入場曲】指定2張敵方戰場上的從者卡。給予其4點傷害。使自己戰場上的土之印+2。" },
    { id: 161, name: "五行巔峰‧久苑", class: "witch", cost: 7, atk: "3", hp: "3", image: "images/wi2-4-1.png", desc: "【入場曲】召喚1張『式神‧天后』與1張『式神‧暴鬼』與1張『式神‧小紙人』到自己的戰場上。<br>【爆能強化_10】破壞自己戰場上全部的式神‧從者卡。召喚1張『式神‧貴人』到自己的戰場上。<br>【超進化時】指定1張自己戰場上的式神‧從者卡。使其獲得【疾馳】。" },
    { id: 162, name: "喚鬼之術", class: "witch", cost: 7, atk: "N/A", hp: "N/A", image: "images/wi2-4-2.png", desc: "【魔力增幅時】使這張卡片的消費-1。<br>召喚1張『式神‧暴鬼』到自己的戰場上。" },
    { id: 163, name: "符文儀式", class: "witch", cost: 7, atk: "N/A", hp: "N/A", image: "images/wi2-4-3.png", desc: "給予敵方戰場上全部的從者卡6點傷害。回復自己的主戰者3點生命值。" },
    { id: 164, name: "暴食的弒滅者‧菈菈安瑟姆", class: "witch", cost: 8, atk: "5", hp: "5", image: "images/wi2-4-4.png", desc: "【光紋】<br>【謝幕曲】【土之秘術_2】召喚1張『暴食的弒滅者‧菈菈安瑟姆』到自己的戰場上。<br>【超進化時】指定2張敵方戰場上的從者卡。將其破壞。" },
    { id: 165, name: "冰雪覺醒", class: "witch", cost: 8, atk: "N/A", hp: "N/A", image: "images/wi2-4-5.png", desc: "【魔力增幅時】使這張卡片的消費-1。<br>指定1張敵方戰場上的從者卡。使其生命值轉變為1。到敵方的回合結束為止，使其獲得「無法攻擊從者或主戰者」。" },
    { id: 166, name: "絕盡的顯現‧萊歐", class: "witch", cost: 10, atk: "9", hp: "9", image: "images/wi2-4-6.png", desc: "【入場曲】使自己牌堆中全部的從者卡消費-3。隨機使1張自己手牌中的法術卡變身為『絕盡的偽證』。到回合結束為止，使其消費轉變為0。" },
    { id: 167, name: "狂焰毀滅者", class: "witch", cost: 9, atk: "8", hp: "6", image: "images/wi2-5-1.png", desc: "【魔力增幅時】使這張卡片的消費-1。" },
    { id: 168, name: "飛越次元", class: "witch", cost: 18, atk: "N/A", hp: "N/A", image: "images/wi2-5-2.png", desc: "【魔力增幅時】使這張卡片的消費-1。<br>使自己手牌中全部的卡片返回牌堆中。由自己的牌堆中抽取5張卡片。使自己手牌中全部的卡片發動5次魔力增幅。使自己的PP回復至上限。" },

    { id: 169, name: "飛躍的銀白幼龍", class: "dragon", cost: 1, atk: "1", hp: "1", image: "images/dr1-1-1.png", desc: "【入場曲】如果【覺醒】已發動，則會由自己的牌堆中抽取1張卡片。<br>【突進】" },
    { id: 170, name: "龍人的潰擊", class: "dragon", cost: 1, atk: "N/A", hp: "N/A", image: "images/dr1-1-2.png", desc: "指定1張敵方戰場上的從者卡。給予其2點傷害。如果【覺醒】已發動，則會由原本的2點傷害轉變為4點傷害。" },
    { id: 171, name: "蒼炎的暴威", class: "dragon", cost: 1, atk: "N/A", hp: "N/A", image: "images/dr1-1-3.png", desc: "指定1張自己戰場上的從者卡。給予其1點傷害。隨機給予1張敵方戰場上的從者卡3點傷害。如果【覺醒】已發動，則會由自己的牌堆中抽取1張龍族‧從者卡。" },
    { id: 172, name: "乙姬的寶扇", class: "dragon", cost: 1, atk: "N/A", hp: "N/A", image: "images/dr1-1-4.png", desc: "消費3【策動】召喚1張『乙姬近衛隊』到自己的戰場上。指定1張自己手牌中的卡片。將其捨棄。" },
    { id: 173, name: "炎龍之劍", class: "dragon", cost: 1, atk: "N/A", hp: "N/A", image: "images/dr1-1-5.png", desc: "消費1【策動】破壞這張卡片。指定1張自己戰場上的從者卡。使其+1/+1並獲得「【謝幕曲】召喚1張『炎龍之劍』到自己的戰場上」。" },
    { id: 174, name: "熾烈的火焰蜥蜴", class: "dragon", cost: 2, atk: "", hp: "", image: "images/dr1-1-6.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。給予其1點傷害。" },
    { id: 175, name: "育龍少女", class: "dragon", cost: 1, atk: "1", hp: "2", image: "images/dr1-2-1.png", desc: "【入場曲】召喚1張『熾炎幼龍』到自己的戰場上。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 176, name: "背負宿願的龍人公主", class: "dragon", cost: 2, atk: "2", hp: "2", image: "images/dr1-2-2.png", desc: "【入場曲】如果自己戰場上有已超進化的從者卡，則會由自己的牌堆中抽取2張卡片。" },
    { id: 177, name: "銀冰龍少女‧菲琳", class: "dragon", cost: 2, atk: "2", hp: "2", image: "images/dr1-2-3.png", desc: "【入場曲】如果【覺醒】已發動，則會增加1張『銀冰吐息』到自己的手牌中。<br>【必殺】<br>【進化時】給予敵方戰場上全部的從者卡1點傷害。" },
    { id: 178, name: "侮蔑的肯定者", class: "dragon", cost: 2, atk: "2", hp: "2", image: "images/dr1-2-4.png", desc: "當這張卡片受到傷害而未被破壞時，如果是自己的回合，則會由自己的牌堆中抽取1張龍族‧從者卡。" },
    { id: 179, name: "梅格的摯友‧瑪莉莉", class: "dragon", cost: 2, atk: "2", hp: "2", image: "images/dr1-2-5.png", desc: "於手牌中發動。當自己原始消費為3的從者卡超進化時，到回合結束為止，使這張卡片的消費轉變為0。<br>自己的回合結束時，隨機使1張自己戰場上已超進化的從者卡+1/+1。" },
    { id: 180, name: "虎鯨的呼喚", class: "dragon", cost: 2, atk: "N/A", hp: "N/A", image: "images/dr1-2-6.png", desc: "召喚1張『滄海虎鯨』到自己的戰場上。如果【覺醒】已發動，則會由自己的牌堆中抽取1張『虎鯨的呼喚』。" },
    { id: 181, name: "馳騁新月浪", class: "dragon", cost: 2, atk: "N/A", hp: "N/A", image: "images/dr1-3-1.png", desc: "使自己獲得『紋章：馳騁新月浪』。<br>紋章<br>【倒數_4】<br>自己的回合結束時，隨機使1張自己戰場上的從者卡+1/+1。" },
    { id: 182, name: "愛情無限‧天女爆彈擊", class: "dragon", cost: 2, atk: "N/A", hp: "N/A", image: "images/dr1-3-2.png", desc: "指定1張敵方戰場上的從者卡。給予其3點傷害。到敵方的回合結束為止，使其獲得「無法攻擊從者或主戰者」。" },
    { id: 183, name: "侮蔑之國", class: "dragon", cost: 2, atk: "N/A", hp: "N/A", image: "images/dr1-3-3.png", desc: "【倒數_4】<br>消費1【策動】給予戰場上全部的從者卡1點傷害。" },
    { id: 184, name: "追風者‧葉花", class: "dragon", cost: 3, atk: "2", hp: "1", image: "images/dr1-3-4.png", desc: "【入場曲】如果【覺醒】已發動，則會使這張卡片獲得【威懾】。<br>【疾馳】" },
    { id: 185, name: "詠風者‧傑魯", class: "dragon", cost: 3, atk: "3", hp: "3", image: "images/dr1-3-5.png", desc: "【超進化時】指定1張自己戰場上的其他從者卡。使其獲得【疾馳】。" },
    { id: 186, name: "榮弦天宮‧琉芙", class: "dragon", cost: 3, atk: "3", hp: "3", image: "images/dr1-3-6.png", desc: "【入場曲】如果【覺醒】已發動，則會使這張卡片進化。<br>當這張卡片進化時，使自己的PP最大值+1。" },
    { id: 187, name: "海洋騎手", class: "dragon", cost: 3, atk: "1", hp: "1", image: "images/dr1-4-1.png", desc: "【入場曲】召喚1張『滄海虎鯨』到自己的戰場上。如果【覺醒】已發動，則會由原本的1張轉變為2張。<br>當自己的海洋‧從者卡進入戰場時，使其獲得【守護】。" },
    { id: 188, name: "大海的追尋者‧喬爾", class: "dragon", cost: 3, atk: "3", hp: "3", image: "images/dr1-4-2.png", desc: "【守護】<br>【光紋】" },
    { id: 189, name: "隨處可見的平凡女孩‧梅格", class: "dragon", cost: 3, atk: "2", hp: "1", image: "images/dr1-4-3.png", desc: "【入場曲】【奧義】使這張卡片超進化。<br>當自己原始消費為2的從者卡進入戰場時，使這張卡片獲得【守護】。" },
    { id: 190, name: "龍之啟迪", class: "dragon", cost: 3, atk: "N/A", hp: "N/A", image: "images/dr1-4-4.png", desc: "使自己的PP最大值+1。隨後，如果自己的PP最大值為10，則會由自己的牌堆中抽取1張卡片。" },
    { id: 191, name: "榮弦的奏樂", class: "dragon", cost: 3, atk: "N/A", hp: "N/A", image: "images/dr1-4-5.png", desc: "由自己的牌堆中抽取2張卡片。如果【覺醒】已發動，則會回復自己的主戰者2點生命值。" },
    { id: 192, name: "疾雷之怒", class: "dragon", cost: 3, atk: "N/A", hp: "N/A", image: "images/dr1-4-6.png", desc: "給予戰場上生命值最高的全部從者卡5點傷害。如果【覺醒】已發動，則會給予生命值最高的全部主戰者3點傷害。" },
    { id: 193, name: "猛擊的龍族勇士", class: "dragon", cost: 4, atk: "4", hp: "5", image: "images/dr1-5-1.png", desc: "【進化時】指定1張敵方戰場上的從者卡。給予其4點傷害。<br>【超進化時】由原本的指定1張轉變為全部。" },
    { id: 194, name: "新手獵龍人", class: "dragon", cost: 4, atk: "2", hp: "2", image: "images/dr1-5-2.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。將其破壞。" },
    { id: 195, name: "白鱗聖使", class: "dragon", cost: 4, atk: "4", hp: "4", image: "images/dr1-5-3.png", desc: "【入場曲】如果【覺醒】已發動，則會回復自己的主戰者4點生命值。" },
    { id: 196, name: "美豔龍人‧瑪利翁", class: "dragon", cost: 4, atk: "3", hp: "3", image: "images/dr1-5-4.png", desc: "【入場曲】指定1張自己戰場上的其他從者卡。使其+2/+2。如果【覺醒】已發動，則會由原本的+2/+2轉變為+3/+3。" },
    { id: 197, name: "咆哮馭龍使", class: "dragon", cost: 5, atk: "5", hp: "5", image: "images/dr1-5-5.png", desc: "【爆能強化_7】召喚1張『巨翼飛龍』到自己的戰場上。" },
    { id: 198, name: "海溝大劍龍", class: "dragon", cost: 5, atk: "4", hp: "6", image: "images/dr1-5-6.png", desc: "【入場曲】如果【覺醒】已發動，則會使這張卡片獲得【疾馳】。" },
    { id: 199, name: "身經百戰的魚人", class: "dragon", cost: 5, atk: "3", hp: "3", image: "images/dr2-1-1.png", desc: "【入場曲】召喚2張『滄海虎鯨』到自己的戰場上。<br>【進化時】召喚1張『滄海虎鯨』到自己的戰場上。" },
    { id: 200, name: "侮蔑的祈禱者", class: "dragon", cost: 5, atk: "3", hp: "5", image: "images/dr2-1-2.png", desc: "【突進】<br>【守護】<br>自己的回合結束時，使這張卡片的生命值回復至上限。回復自己的主戰者X點生命值。X為「這張卡片所回復的生命值」。" },
    { id: 201, name: "烈絕的顯現‧嘉魯蜜兒", class: "dragon", cost: 5, atk: "5", hp: "5", image: "images/dr2-1-3.png", desc: "【入場曲】使自己獲得『紋章：烈絕的顯現‧嘉魯蜜兒』。<br>【爆能強化_7】使這張卡片獲得【疾馳】。<br>當這張卡片受到傷害而未被破壞時，每個自己的回合僅限發動1次，隨機給予1張敵方戰場上的從者卡3點傷害。<br>紋章<br>當自己的從者卡受到傷害而未被破壞時，每個自己的回合僅限發動1次，增加1張『烈絕的滅牙』到自己的手牌中。" },
    { id: 202, name: "凍結的宿命‧依舒宓爾", class: "dragon", cost: 5, atk: "5", hp: "4", image: "images/dr2-1-4.png", desc: "【入場曲】如果自己的PP最大值為10，則會使這張卡片進化。<br>當這張卡片進化時，給予敵方戰場上全部的從者卡3點傷害。" },
    { id: 203, name: "世界的同伴‧佐伊", class: "dragon", cost: 5, atk: "5", hp: "5", image: "images/dr2-1-5.png", desc: "【入場曲】使自己的PP最大值+1。<br>【爆能強化_10】使這張卡片獲得【疾馳】。使自己主戰者生命值的最大值轉變為1。到敵方的回合結束為止，使自己的主戰者獲得「受到的傷害為1以上時轉變為0」。" },
    { id: 204, name: "吸收星晶獸", class: "dragon", cost: 5, atk: "N/A", hp: "N/A", image: "images/dr2-1-6.png", desc: "指定1張敵方戰場上的卡片。使其消失，並增加1張與其同名的卡片到自己的手牌中。" },
    { id: 205, name: "戰斧弒龍者", class: "dragon", cost: 6, atk: "5", hp: "10", image: "images/dr2-2-1.png", desc: "【守護】" },
    { id: 206, name: "煌牙義勇‧基德", class: "dragon", cost: 6, atk: "8", hp: "7", image: "images/dr2-2-2.png", desc: "當這張卡片被捨棄時，隨機使1張自己戰場上的從者卡+1/+0。<br>【突進】" },
    { id: 207, name: "駭浪龍騎士‧薩哈爾", class: "dragon", cost: 6, atk: "3", hp: "3", image: "images/dr2-2-3.png", desc: "【入場曲】召喚1張『巨翼飛龍』到自己的戰場上。<br>【守護】" },
    { id: 208, name: "霸道龍翼‧法露特", class: "dragon", cost: 6, atk: "5", hp: "2", image: "images/dr2-2-4.png", desc: "【疾馳】<br>【威懾】" },
    { id: 209, name: "舞冰的龍人", class: "dragon", cost: 6, atk: "6", hp: "6", image: "images/dr2-2-5.png", desc: "【入場曲】破壞敵方戰場上已受到傷害的全部從者卡。" },
    { id: 210, name: "侮蔑的團結者", class: "dragon", cost: 6, atk: "5", hp: "7", image: "images/dr2-2-6.png", desc: "入場曲】給予戰場上全部的從者卡3點傷害。<br>自己的回合結束時，如果這張卡片的生命值為3以下，則會使自己手牌中全部的龍族‧從者卡+1/+1。" },
    { id: 211, name: "災禍的吐息", class: "dragon", cost: 6, atk: "N/A", hp: "N/A", image: "images/dr2-3-1.png", desc: "給予戰場上全部的從者卡5點傷害。" },
    { id: 212, name: "龍魂合擊", class: "dragon", cost: 6, atk: "N/A", hp: "N/A", image: "images/dr2-3-2.png", desc: "指定1張自己手牌中的卡片。使其消費-2。給予敵方戰場上全部的從者卡3點傷害。" },
    { id: 213, name: "灼熱的弒滅者‧珀德奈特", class: "dragon", cost: 7, atk: "7", hp: "7", image: "images/dr2-3-3.png", desc: "【入場曲】指定1張自己手牌中的卡片。將其捨棄。給予敵方戰場上全部的從者卡X點傷害。X為「所指定卡片的消費值」。<br>【超進化時】使敵方獲得『紋章：灼熱的弒滅者‧珀德奈特』。<br>紋章<br>自己的回合開始時，給予自己的主戰者1點傷害。當自己的主戰者回復生命值時，每個自己的回合僅限發動1次，給予自己的主戰者1點傷害。" },
    { id: 214, name: "蒼海的制裁‧尼普頓", class: "dragon", cost: 7, atk: "5", hp: "5", image: "images/dr2-3-4.png", desc: "【入場曲】使自己獲得『紋章：蒼海的制裁‧尼普頓』。召喚2張『滄海虎鯨』到自己的戰場上。<br>【守護】<br>【超進化時】召喚2張『滄海虎鯨』到自己的戰場上。<br>紋章<br>當自己的海洋‧從者卡進入戰場時，回復自己的主戰者1點生命值。" },
    { id: 215, name: "炎之攝理‧維爾納斯", class: "dragon", cost: 7, atk: "8", hp: "6", image: "images/dr2-3-5.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。給予其8點傷害。<br>【威懾】<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 216, name: "凶鯊戰士", class: "dragon", cost: 8, atk: "6", hp: "6", image: "images/dr2-3-6.png", desc: "【入場曲】給予敵方的主戰者6點傷害。" },
    { id: 217, name: "雲海龍騎兵", class: "dragon", cost: 8, atk: "6", hp: "6", image: "images/dr2-4-1.png", desc: "【守護】<br>【謝幕曲】召喚1張『巨翼飛龍』到自己的戰場上。" },
    { id: 218, name: "龍人演義‧臥龍", class: "dragon", cost: 8, atk: "5", hp: "5", image: "images/dr2-4-2.png", desc: "【入場曲】召喚1張『霸業之金龍』與1張『霸業之銀龍』到自己的戰場上。<br>【超進化時】使自己戰場上全部的『霸業之金龍』獲得【疾馳】。使自己戰場上全部的『霸業之銀龍』獲得【障壁】。" },
    { id: 219, name: "絢爛鳳凰‧小鳳", class: "dragon", cost: 8, atk: "4", hp: "4", image: "images/dr2-4-3.png", desc: "【入場曲】使自己牌堆中全部的卡片消費減半。" },
    { id: 220, name: "純樸鋼體‧無限", class: "dragon", cost: 8, atk: "10", hp: "8", image: "images/dr2-4-4.png", desc: "【入場曲】【解放奧義】使這張卡片獲得【疾馳】。<br>【超進化時】指定2張敵方戰場上的從者卡。將其破壞。" },
    { id: 221, name: "薄暮闇龍", class: "dragon", cost: 9, atk: "9", hp: "9", image: "images/dr2-4-5.png", desc: "【入場曲】使敵方戰場上全部的從者卡-0/-9。<br>【超進化時】由自己的牌堆中抽取3張卡片。" },
    { id: 222, name: "侮蔑的繼承者‧亞喬拉斐特", class: "dragon", cost: 9, atk: "5", hp: "7", image: "images/dr2-4-6.png", desc: "【入場曲】發動3次「給予戰場上全部的從者卡2點傷害」。<br>【守護】<br>當這張卡片受到傷害而未被破壞時，如果是自己的回合，則會給予敵方的主戰者1點傷害。<br>【超進化時】使這張卡片的生命值回復至上限。發動3次「給予戰場上全部的從者卡2點傷害」。" },
    { id: 223, name: "再臨之創世龍", class: "dragon", cost: 10, atk: "9", hp: "10", image: "images/dr2-5-1.png", desc: "【疾馳】" },
    { id: 224, name: "呵護的智龍", class: "dragon", cost: 10, atk: "4", hp: "4", image: "images/dr2-5-2.png", desc: "於手牌中發動。當自己的從者卡超進化時，使這張卡片的消費-3。<br>【入場曲】召喚1張『巨翼飛龍』到自己的戰場上。" },

    { id: 225, name: "妖惑魅魔‧莉莉姆", class: "abyss", cost: 1, atk: "1", hp: "1", image: "images/ab1-1-1.png", desc: "【謝幕曲】增加1張『蝙蝠』到自己的手牌中。" },
    { id: 226, name: "怨恨的栽培者", class: "abyss", cost: 1, atk: "1", hp: "1", image: "images/ab1-1-2.png", desc: "【謝幕曲】增加1張『怨靈』到自己的手牌中。" },
    { id: 227, name: "死神揮鐮", class: "abyss", cost: 1, atk: "N/A", hp: "N/A", image: "images/ab1-1-3.png", desc: "指定1張自己戰場上的從者卡與1張敵方戰場上的從者卡。將其破壞。" },
    { id: 228, name: "凶惡的小木乃伊", class: "abyss", cost: 2, atk: "2", hp: "2", image: "images/ab1-1-4.png", desc: "【入場曲】【死靈術_4】使這張卡片獲得【疾馳】。" },
    { id: 229, name: "無名惡魔", class: "abyss", cost: 2, atk: "2", hp: "2", image: "images/ab1-1-5.png", desc: "【進化時】召喚2張『蝙蝠』到自己的戰場上。" },
    { id: 230, name: "幹練死神‧蜜諾", class: "abyss", cost: 2, atk: "2", hp: "1", image: "images/ab1-1-6.png", desc: "【爆能強化_4】使這張卡片獲得【突進】與【必殺】。<ab>【謝幕曲】增加1張『骷髏士兵』到自己的手牌中。" },
    { id: 231, name: "夢魔‧維莉", class: "abyss", cost: 2, atk: "2", hp: "3", image: "images/ab1-2-1.png", desc: "【入場曲】給予自己的主戰者3點傷害。<br>【進化時】回復自己的主戰者5點生命值。" },
    { id: 232, name: "盛燃的魔劍‧歐特魯斯", class: "abyss", cost: 2, atk: "2", hp: "2", image: "images/ab1-2-2.png", desc: "【入場曲】使自己的墓場+2。<br>【守護】<br>【進化時】【死靈術_4】發動2次「隨機給予1張敵方戰場上的從者卡2點傷害」。" },
    { id: 233, name: "新任護墓者", class: "abyss", cost: 2, atk: "2", hp: "2", image: "images/ab1-2-3.png", desc: "【爆能強化_7】發動【亡者召還_5】與【亡者召還_3】。" },
    { id: 234, name: "混融的繼承者‧夏姆‧娜可亞", class: "abyss", cost: 2, atk: "2", hp: "2", image: "images/ab1-2-4.png", desc: "【入場曲】使信仰值-10，並使自己的信仰獲得「自己可指定的【模式】數+1」。<br>【超進化時】指定1張敵方戰場上的從者卡。將其破壞，並增加1張與其同名的卡片到自己的手牌中。<br>信仰<br>信仰值由0開始。<br>當自己指定【模式】時，使信仰值+1。" },
    { id: 235, name: "憧憬之鐵鎚‧阿爾梅達", class: "abyss", cost: 2, atk: "3", hp: "1", image: "images/ab1-2-5.png", desc: "【爆能強化_4】使這張卡片進化。使這張卡片+1/+1。<br>【突進】" },
    { id: 236, name: "混沌怨咒", class: "abyss", cost: 2, atk: "N/A", hp: "N/A", image: "images/ab1-2-6.png", desc: "指定1個【模式】並發動該能力。<br>（1）由自己的牌堆中抽取1張從者卡。<br>（2）發動【亡者召還_2】。" },
    { id: 237, name: "捕食靈魂", class: "abyss", cost: 2, atk: "N/A", hp: "N/A", image: "images/ab1-3-1.png", desc: "指定1張自己戰場上的從者卡。將其破壞。由自己的牌堆中抽取2張卡片。" },
    { id: 238, name: "蛇神的嗔怒", class: "abyss", cost: 2, atk: "N/A", hp: "N/A", image: "images/ab1-3-2.png", desc: "指定1張敵方戰場上的從者卡或敵方的主戰者。給予其3點傷害。給予自己的主戰者2點傷害。" },
    { id: 239, name: "詛咒派對", class: "abyss", cost: 2, atk: "N/A", hp: "N/A", image: "images/ab1-3-3.png", desc: "增加1張『怨靈』與1張『骷髏士兵』與1張『腐臭的殭屍』到自己的手牌中。" },
    { id: 240, name: "役使蝙蝠", class: "abyss", cost: 2, atk: "N/A", hp: "N/A", image: "images/ab1-3-4.png", desc: "召喚2張『蝙蝠』到自己的戰場上。" },
    { id: 241, name: "異變銳擊", class: "abyss", cost: 2, atk: "N/A", hp: "N/A", image: "images/ab1-3-5.png", desc: "給予自己的主戰者2點傷害。使自己獲得『紋章：異變銳擊』。<br>紋章<br>【倒數_2】<br>自己的回合結束時，隨機給予1張敵方戰場上的從者卡2點傷害。回復自己的主戰者1點生命值。" },
    { id: 242, name: "混融之城", class: "abyss", cost: 2, atk: "N/A", hp: "N/A", image: "images/ab1-3-6.png", desc: "【入場曲】指定1個【模式】並發動該能力。<br>（1）由自己的牌堆中抽取1張卡片。<br>（2）隨機使1張自己戰場上的從者卡+1/+1。<br>消費1【策動】破壞這張卡片。發動與【入場曲】相同的能力。" },
    { id: 243, name: "暗夜鬼人", class: "abyss", cost: 3, atk: "4", hp: "3", image: "images/ab1-4-1.png", desc: "【入場曲】給予自己的主戰者1點傷害。" },
    { id: 244, name: "午夜的吸血鬼‧艾菈露", class: "abyss", cost: 3, atk: "1", hp: "1", image: "images/ab1-4-2.png", desc: "【入場曲】召喚1張『蝙蝠』到自己的戰場上。<br>當自己的『蝙蝠』進入戰場時，使其獲得【疾馳】。給予自己的主戰者1點傷害。" },
    { id: 245, name: "役骨少女", class: "abyss", cost: 3, atk: "1", hp: "2", image: "images/ab1-4-3.png", desc: "【謝幕曲】召喚2張『骷髏士兵』到自己的戰場上。" },
    { id: 246, name: "法外的賞金獵人‧巴爾特", class: "abyss", cost: 3, atk: "3", hp: "1", image: "images/ab1-4-4.png", desc: "【入場曲】使自己獲得『紋章：法外的賞金獵人‧巴爾特』。<br>紋章<br>【倒數_4】<br>自己的回合結束時，給予全部的主戰者1點傷害。" },
    { id: 247, name: "狂風之翼‧圮尤菈", class: "abyss", cost: 3, atk: "2", hp: "4", image: "images/ab1-4-5.png", desc: "【突進】<br>當自己的其他從者卡超進化時，使其與這張卡片+2/+0。" },
    { id: 248, name: "殘虐戰爭‧蘿拉", class: "abyss", cost: 3, atk: "3", hp: "2", image: "images/ab1-4-6.png", desc: "【入場曲】指定1張自己戰場上的其他從者卡。使其獲得【必殺】。<br>【超進化時】指定1張自己戰場上的其他從者卡。使其獲得【疾馳】。" },
    { id: 249, name: "混融的肯定者", class: "abyss", cost: 3, atk: "1", hp: "1", image: "images/ab1-5-1.png", desc: "【入場曲】指定1個【模式】並發動該能力。<br>（1）給予敵方戰場上全部的從者卡1點傷害。<br>（2）使這張卡片+2/+2。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 250, name: "愛之旅人‧薩堤爾", class: "abyss", cost: 3, atk: "3", hp: "3", image: "images/ab1-5-2.png", desc: "【入場曲】如果自己戰場上有已進化的從者卡，則會使這張卡片進化。<br>【光紋】" },
    { id: 251, name: "元素共鳴‧巴力", class: "abyss", cost: 3, atk: "2", hp: "2", image: "images/ab1-5-3.png", desc: "【入場曲】指定1個【模式】並發動該能力。<br>（1）使隨機1張自己戰場上的其他從者卡與這張卡片各+1/+1。<br>（2）隨機給予1張敵方戰場上的從者卡3點傷害。" },
    { id: 252, name: "叫喚與憎惡", class: "abyss", cost: 3, atk: "N/A", hp: "N/A", image: "images/ab1-5-4.png", desc: "指定2個【模式】並發動該能力。<br>（1）回復自己的PP 1點。<br>（2）由自己的牌堆中抽取1張從者卡。<br>（3）由自己的牌堆中抽取1張消費為3的法術卡。<br>（4）隨機給予1張敵方戰場上的從者卡4點傷害。" },
    { id: 253, name: "瞑地的靈園", class: "abyss", cost: 3, atk: "N/A", hp: "N/A", image: "images/ab1-5-5.png", desc: "【入場曲】使自己的墓場+2。<br>【策動】破壞這張卡片。召喚2張『怨靈』到自己的戰場上。" },
    { id: 254, name: "多情的死靈法師", class: "abyss", cost: 4, atk: "5", hp: "4", image: "images/ab1-5-6.png", desc: "【進化時】召喚2張『怨靈』到自己的戰場上。<br>【超進化時】使其獲得【吸血】。" },
    { id: 255, name: "奇異探索者‧尤娜", class: "abyss", cost: 4, atk: "3", hp: "5", image: "images/ab2-1-1.png", desc: "【守護】<br>【謝幕曲】增加1張『怨靈』與1張『蝙蝠』到自己的手牌中。" },
    { id: 256, name: "藍薔薇千金‧賽蕾絲", class: "abyss", cost: 4, atk: "1", hp: "4", image: "images/ab2-1-2.png", desc: "【必殺】<br>自己的回合結束時，回復自己的主戰者2點生命值。如果這張卡片已超進化，則會由原本的回復2點轉變為回復4點。使這張卡片獲得【障壁】。" },
    { id: 257, name: "瞑地天宮‧穆坎", class: "abyss", cost: 4, atk: "3", hp: "3", image: "images/ab2-1-3.png", desc: "【入場曲】【死靈術_8】使這張卡片進化。<br>當自己的死者‧從者卡進入戰場時，使其獲得【必殺】。<br>當這張卡片進化時，召喚1張『怨靈』到自己的戰場上。" },
    { id: 258, name: "暮夜魔將‧艾瑟菈", class: "abyss", cost: 4, atk: "1", hp: "3", image: "images/ab2-1-4.png", desc: "【入場曲】使這張卡片+X/+0。X為「自己戰場上的其他從者卡張數」。給予自己的主戰者2點傷害。<br>【疾馳】<br>" },
    { id: 259, name: "混融的祈禱者", class: "abyss", cost: 4, atk: "4", hp: "4", image: "images/ab2-1-5.png", desc: "【入場曲】指定1個【模式】並發動該能力。<br>（1）隨機給予1張敵方戰場上的從者卡3點傷害。<br>（2）回復自己的主戰者2點生命值。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 260, name: "暴虐的行進", class: "abyss", cost: 4, atk: "N/A", hp: "N/A", image: "images/ab2-1-6.png", desc: "給予隨機2張敵方戰場上的從者卡與敵方的主戰者各2點傷害。" },
    { id: 261, name: "禁約惡魔", class: "abyss", cost: 5, atk: "4", hp: "4", image: "images/ab2-2-1.png", desc: "【入場曲】由自己的牌堆中抽取2張卡片。給予自己的主戰者2點傷害。<br>【進化時】指定1張敵方戰場上的從者卡。給予其6點傷害。" },
    { id: 262, name: "無盡獵人‧阿拉加維", class: "abyss", cost: 5, atk: "4", hp: "3", image: "images/ab2-2-2.png", desc: "【入場曲】對敵方戰場上全部的從者卡分配7點傷害。<br>【進化時】給予全部的主戰者3點傷害。" },
    { id: 263, name: "白銀槍彈‧雷文", class: "abyss", cost: 5, atk: "3", hp: "4", image: "images/ab2-2-3.png", desc: "【必殺】<br>【進化時】指定2張敵方戰場上的從者卡。將其破壞。給予自己的主戰者2點傷害。" },
    { id: 264, name: "流墮的冥河‧凱倫", class: "abyss", cost: 5, atk: "4", hp: "4", image: "images/ab2-2-4.png", desc: "【入場曲】發動【亡者召還_2】與【亡者召還_1】。<br>當自己的死者‧從者卡進入戰場時，使其獲得【守護】。<br>【超進化時】使自己獲得『紋章：流墮的冥河‧凱倫』。<br>紋章<br>【倒數_2】<br>自己的回合開始時，發動【亡者召還_3】。" },
    { id: 265, name: "混融的團結者", class: "abyss", cost: 5, atk: "4", hp: "4", image: "images/ab2-2-5.png", desc: "【入場曲】指定1個【模式】並發動該能力。<br>（1）召喚1張『混融的團結者』到自己的戰場上。使其與這張卡片獲得【突進】。<br>（2）召喚1張『混融的團結者』到自己的戰場上。使其與這張卡片獲得【守護】。<br>（3）使自己戰場上全部的『混融的團結者』+2/+2。<br>【超進化時】發動與【入場曲】相同的能力。" },
    { id: 266, name: "腐敗侵襲", class: "abyss", cost: 5, atk: "N/A", hp: "N/A", image: "images/ab2-2-6.png", desc: "使戰場上全部的從者卡-2/-2。使自己與敵方獲得『紋章：腐敗侵襲』。【解放奧義】破壞自己的『紋章：腐敗侵襲』。<br>紋章<br>【倒數_4】<br>自己的回合結束時，給予自己的主戰者2點傷害。" },
    { id: 267, name: "魔狼首領", class: "abyss", cost: 6, atk: "3", hp: "6", image: "images/ab2-3-1.png", desc: "【疾馳】<br>【必殺】" },
    { id: 268, name: "雜技亡魂", class: "abyss", cost: 6, atk: "5", hp: "5", image: "images/ab2-3-2.png", desc: "【入場曲】發動【亡者召還_4】。" },
    { id: 269, name: "屍骸士兵", class: "abyss", cost: 6, atk: "3", hp: "3", image: "images/ab2-3-3.png", desc: "【入場曲】召喚2張『腐臭的殭屍』到自己的戰場上。" },
    { id: 270, name: "不屈的銳刃‧巴薩拉加", class: "abyss", cost: 6, atk: "2", hp: "7", image: "images/ab2-3-4.png", desc: "【威懾】<br>【謝幕曲】召喚1張『不屈的銳刃‧巴薩拉加』到自己的戰場上。給予自己的主戰者2點傷害。" },
    { id: 271, name: "霸空武神‧哪吒", class: "abyss", cost: 6, atk: "8", hp: "6", image: "images/ab2-3-5.png", desc: "【突進】<br>自己的回合結束時，隨機給予1張敵方戰場上的從者卡4點傷害。隨機給予1張敵方戰場上的從者卡2點傷害。" },
    { id: 272, name: "生滅的技巧‧涅槃", class: "abyss", cost: 6, atk: "2", hp: "4", image: "images/ab2-3-6.png", desc: "【入場曲】使自己戰場上全部進化前的從者卡進化。給予自己的主戰者2點傷害。<br>【吸血】<br>" },
    { id: 273, name: "烈毒公主‧梅杜莎", class: "abyss", cost: 7, atk: "3", hp: "7", image: "images/ab2-4-1.png", desc: "【突進】<br>1回合中可進行3次攻擊。<br>【攻擊時】如果對從者卡進行攻擊，則會破壞交戰對象。" },
    { id: 274, name: "絕叫與愛絕的顯現‧魯魯納伊＆瓦娜蕾格", class: "abyss", cost: 7, atk: "5", hp: "5", image: "images/ab2-4-2.png", desc: "【入場曲】指定1個【模式】並發動該能力。<br>（1）增加1張『絕叫的擴散』到自己的手牌中。<br>（2）增加1張『愛絕的飛翔』到自己的手牌中。" },
    { id: 275, name: "闇之攝理‧菲迪耶爾", class: "abyss", cost: 7, atk: "5", hp: "5", image: "images/ab2-4-3.png", desc: "【入場曲】【死靈術_6】發動【亡者召還_2】與【亡者召還_1】。使其進化。<br>自己的回合結束時，使敵方戰場上全部的從者卡-2/-2。" },
    { id: 276, name: "狡智的墮天司‧彼列", class: "abyss", cost: 7, atk: "", hp: "", image: "images/ab2-4-4.png", desc: "【入場曲】給予戰場上全部的其他從者卡10點傷害。【解放奧義】使自己獲得『紋章：狡智的墮天司‧彼列』。<br>【超進化時】使自己的『紋章：狡智的墮天司‧彼列』倒數回合數-1。<br>紋章<br>【倒數_4】<br>【謝幕曲】給予敵方的主戰者20點傷害。" },
    { id: 277, name: "穿刺公‧弗拉德", class: "abyss", cost: 8, atk: "5", hp: "8", image: "images/ab2-4-5.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。給予其5點傷害。回復自己的主戰者5點生命值。" },
    { id: 278, name: "奔放的獄炎‧凱爾貝洛斯", class: "abyss", cost: 8, atk: "6", hp: "6", image: "images/ab2-4-6.png", desc: "【入場曲】召喚1張『守衛犬的右腕‧米米』與1張『守衛犬的左腕‧可可』到自己的戰場上。【死靈術_6】使自己戰場上全部的其他從者卡+2/+0。<br>【超進化時】發動2次【亡者召還_1】。" },
    { id: 279, name: "泡沫的鬼姬", class: "abyss", cost: 8, atk: "4", hp: "6", image: "images/ab2-5-1.png", desc: "【入場曲】指定2張敵方戰場上的從者卡。將其破壞。給予自己的主戰者4點傷害。<br>【疾馳】" },
    { id: 280, name: "雙禍夜行‧吟雪＆夕月", class: "abyss", cost: 9, atk: "5", hp: "5", image: "images/ab2-5-2.png", desc: "【入場曲】指定1個【模式】並發動該能力。<br>（1）召喚4張『一尾狐』到自己的戰場上。<br>（2）隨機破壞4張敵方戰場上的從者卡。回復自己的主戰者4點生命值。" },



    { id: 281, name: "利利耶的撩動", class: "bishop", cost: 0, atk: "N/A", hp: "N/A", image: "images/bi1-1-1.png", desc: "消費2【策動】破壞這張卡片。指定1張自己戰場上的從者卡。使其變身為『利利耶的撩動』。由自己的牌堆中抽取1張卡片。" },
    { id: 282, name: "攜持魔杖的外科醫生‧媞可", class: "bishop", cost: 1, atk: "0", hp: "4", image: "images/bi1-1-2.png", desc: "當自己進行護符卡的【策動】時，回復自己的主戰者1點生命值。<br>【進化時】指定1張敵方戰場上的從者卡。給予其3點傷害。" },
    { id: 283, name: "神聖防禦", class: "bishop", cost: 1, atk: "N/A", hp: "N/A", image: "images/bi1-1-3.png", desc: "指定1張自己戰場上擁有【守護】的從者卡。使其+0/+1。隨機給予1張敵方戰場上的從者卡X點傷害。X為「所指定從者卡的生命值」。" },
    { id: 284, name: "擁翼的石像", class: "bishop", cost: 1, atk: "N/A", hp: "N/A", image: "images/bi1-1-4.png", desc: "【倒數_4】<br>【謝幕曲】召喚1張『神聖獵鷹』到自己的戰場上。<br>消費1【策動】使這張卡片的倒數回合數-1。" },
    { id: 285, name: "平靜的教會", class: "bishop", cost: 1, atk: "N/A", hp: "N/A", image: "images/bi1-1-5.png", desc: "【倒數_3】<br>【謝幕曲】由自己的牌堆中抽取2張卡片。<br>消費1【策動】使這張卡片的倒數回合數-1。" },
    { id: 286, name: "純淨白狐", class: "bishop", cost: 2, atk: "1", hp: "3", image: "images/bi1-1-6.png", desc: "【守護】" },
    { id: 287, name: "潛伏的曼紐", class: "bishop", cost: 2, atk: "2", hp: "2", image: "images/bi1-2-1.png", desc: "【光紋】<br>當自己進行護符卡的【策動】時，到回合結束為止，使這張卡片+1/+0。" },
    { id: 288, name: "煌槍月兔妖‧薩莉沙", class: "bishop", cost: 2, atk: "2", hp: "2", image: "images/bi1-2-2.png", desc: "當自己擁有【守護】的從者卡被破壞時，使這張卡片+1/+1。<br>【進化時】使這張卡片獲得【障壁】。" },
    { id: 289, name: "惡意的神諭‧達姆斯", class: "bishop", cost: 2, atk: "2", hp: "2", image: "images/bi1-2-3.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。使其獲得「自己的回合結束時，破壞這張卡片」。" },
    { id: 290, name: "安息的肯定者", class: "bishop", cost: 2, atk: "0", hp: "4", image: "images/bi1-2-4.png", desc: "【入場曲】使自己獲得『紋章：安息的肯定者』。<br>紋章<br>【倒數_4】<br>自己的回合結束時，如果本回合中自己的從者卡未進行攻擊，則會隨機使1張自己戰場上的從者卡-2/-0並獲得【守護】。" },
    { id: 291, name: "聖騎士的團員", class: "bishop", cost: 2, atk: "2", hp: "2", image: "images/bi1-2-5.png", desc: "【守護】<br>當這張卡片的攻擊力或生命值在戰場上因「+」而增加時，回復自己的主戰者1點生命值。" },
    { id: 292, name: "清廉的修道女‧拉姆瑞塔", class: "bishop", cost: 2, atk: "1", hp: "4", image: "images/bi1-2-6.png", desc: "自己的回合結束時，如果這張卡片已進化，則會給予戰場上全部的從者卡2點傷害。<br>【進化時】到回合結束為止，使這張卡片獲得「無法攻擊從者或主戰者」。" },
    { id: 293, name: "禁密的聖地", class: "bishop", cost: 2, atk: "N/A", hp: "N/A", image: "images/bi1-3-1.png", desc: "消費1【策動】指定1張自己戰場上的從者卡。使其+1/+1。回復自己的主戰者1點生命值。" },
    { id: 294, name: "野獸公主的誓約", class: "bishop", cost: 2, atk: "N/A", hp: "N/A", image: "images/bi1-3-2.png", desc: "【倒數_2】<br>【謝幕曲】召喚1張『聖炎猛虎』到自己的戰場上。<br>消費1【策動】使這張卡片的倒數回合數-1。" },
    { id: 295, name: "輝光香爐", class: "bishop", cost: 2, atk: "N/A", hp: "N/A", image: "images/bi1-3-3.png", desc: "消費1【策動】破壞這張卡片。回復自己的主戰者4點生命值。" },
    { id: 296, name: "聖心之光稜牧師", class: "bishop", cost: 3, atk: "2", hp: "2", image: "images/bi1-3-4.png", desc: "【入場曲】由自己的牌堆中抽取1張護符卡。<br>【進化時】指定1張自己手牌中的護符卡。使其消費-1。" },
    { id: 297, name: "聖盾神官", class: "bishop", cost: 3, atk: "2", hp: "1", image: "images/bi1-3-5.png", desc: "【守護】<br>【障壁】" },
    { id: 298, name: "猛碎的聖職者", class: "bishop", cost: 3, atk: "2", hp: "4", image: "images/bi1-3-6.png", desc: "【守護】<br>【進化時】指定1張敵方戰場上已超進化的從者卡。將其破壞。" },
    { id: 299, name: "彈雨驅魔師‧珂蕾特", class: "bishop", cost: 3, atk: "2", hp: "2", image: "images/bi1-4-1.png", desc: "【入場曲】發動1次「隨機給予1張敵方戰場上的從者卡2點傷害」。如果自己戰場上的護符卡張數為2以上，則會由原本的1次轉變為2次。" },
    { id: 300, name: "安息的祈禱者", class: "bishop", cost: 3, atk: "1", hp: "4", image: "images/bi1-4-2.png", desc: "【入場曲】使自己獲得『紋章：安息的祈禱者』。<br>【守護】<br>紋章<br>【倒數_4】<br>自己的回合結束時，如果本回合中自己的從者卡未進行攻擊，則會回復自己的主戰者1點生命值。" },
    { id: 301, name: "英雄幻視‧特爾", class: "bishop", cost: 3, atk: "2", hp: "1", image: "images/bi1-4-3.png", desc: "【疾馳】<br>當自己進行護符卡的【策動】時，使這張卡片獲得【吸血】。" },
    { id: 302, name: "土之攝理‧嘉列翁", class: "bishop", cost: 3, atk: "5", hp: "5", image: "images/bi1-4-4.png", desc: "【守護】<br>無法攻擊從者或主戰者。<br>自己的回合結束時，如果為已超進化解禁的回合，則會隨機使1張自己戰場上「本回合中未進行攻擊且為進化前的從者卡」進化。" },
    { id: 303, name: "聖潔注射", class: "bishop", cost: 3, atk: "N/A", hp: "N/A", image: "images/bi1-4-5.png", desc: "【策動】破壞這張卡片。指定1張敵方戰場上的從者卡。給予其4點傷害。回復自己的主戰者1點生命值。" },
    { id: 304, name: "安息的神殿", class: "bishop", cost: 3, atk: "N/A", hp: "N/A", image: "images/bi1-4-6.png", desc: "【倒數_4】<br>【謝幕曲】回復自己的主戰者2點生命值。使自己的主戰者獲得【障壁】。<br>【策動】使這張卡片的倒數回合數-X。X為「自己的紋章數」。" },
    { id: 305, name: "展翼獅像", class: "bishop", cost: 3, atk: "N/A", hp: "N/A", image: "images/bi1-5-1.png", desc: "【倒數_3】<br>【謝幕曲】召喚1張『神聖獵鷹』與1張『聖炎猛虎』到自己的戰場上。<br>消費1【策動】使這張卡片的倒數回合數-1。" },
    { id: 306, name: "蕾菲爾的寶石", class: "bishop", cost: 3, atk: "N/A", hp: "N/A", image: "images/bi1-5-2.png", desc: "【策動】破壞這張卡片。指定1個【模式】並發動該能力。<br>（1）隨機破壞1張敵方戰場上的從者卡。<br>（2）由自己的牌堆中抽取2張卡片。" },
    { id: 307, name: "飛翼戰士", class: "bishop", cost: 4, atk: "4", hp: "4", image: "images/bi1-5-3.png", desc: "【入場曲】指定1張自己戰場上的其他從者卡。使其+1/+1。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 308, name: "鐵拳神父", class: "bishop", cost: 4, atk: "5", hp: "4", image: "images/bi1-5-4.png", desc: "【進化時】指定1張敵方戰場上生命值為3以下的從者卡。使其消失。<br>【超進化時】由原本的指定1張轉變為全部。" },
    { id: 309, name: "煌羽翼族‧莉諾", class: "bishop", cost: 4, atk: "3", hp: "5", image: "images/bi1-5-5.png", desc: "【交戰時】給予敵方的主戰者1點傷害。<br>【超進化時】使這張卡片獲得「1回合中可進行2次攻擊」。" },
    { id: 310, name: "禁密天宮‧羅納威洛", class: "bishop", cost: 4, atk: "1", hp: "3", image: "images/bi1-5-6.png", desc: "【潛行】<br>【進化時】指定1張敵方戰場上的從者卡。將其破壞。" },
    { id: 311, name: "絕望的顯現‧瑪文", class: "bishop", cost: 4, atk: "4", hp: "4", image: "images/bi2-1-1.png", desc: "【入場曲】增加1張『絕望的奔流』到自己的手牌中。<br>【進化時】使自己獲得『紋章：絕望的顯現‧瑪文』。<br>紋章<br>自己的回合結束時，如果本回合中自己的從者卡未進行攻擊，則會對敵方戰場上全部的從者卡與敵方的主戰者分配X點傷害。X為「自己的紋章數」。" },
    { id: 312, name: "砂神的巫女‧莎拉", class: "bishop", cost: 4, atk: "4", hp: "10", image: "images/bi2-1-2.png", desc: "【爆能強化_6】使這張卡片+0/+10。【守護】<br>【進化時】指定1張敵方戰場上已受到傷害的從者卡。將其破壞。" },
    { id: 313, name: "賽恩教的僧侶‧蘇菲雅", class: "bishop", cost: 4, atk: "3", hp: "5", image: "images/bi2-1-3.png", desc: "【入場曲】隨機將1張「自己牌堆中消費為2以下的主教‧從者卡」召喚到自己的戰場上。<br>【超進化時】使自己戰場上全部的其他從者卡獲得【障壁】。" },
    { id: 314, name: "癲狂之恩寵", class: "bishop", cost: 4, atk: "N/A", hp: "N/A", image: "images/bi2-1-4.png", desc: "回復自己的主戰者10點生命值。使自己獲得『紋章：癲狂之恩寵』。<br>紋章<br>【倒數_2】<br>【謝幕曲】給予自己的主戰者10點傷害。" },
    { id: 315, name: "聖潔閃光", class: "bishop", cost: 4, atk: "N/A", hp: "N/A", image: "images/bi2-1-5.png", desc: "給予敵方戰場上全部的從者卡3點傷害。<br>【爆能強化_8】由自己的牌堆中抽取3張卡片。回復自己的主戰者3點生命值。" },
    { id: 316, name: "鳥像的投影", class: "bishop", cost: 4, atk: "N/A", hp: "N/A", image: "images/bi2-1-6.png", desc: "【倒數_2】<br>【謝幕曲】召喚1張『壯麗大神隼』到自己的戰場上。<br>消費2【策動】使這張卡片的倒數回合數-2。" },
    { id: 317, name: "閃耀的絕念", class: "bishop", cost: 4, atk: "N/A", hp: "N/A", image: "images/bi2-2-1.png", desc: "【倒數_4】<br>【謝幕曲】對敵方戰場上全部的從者卡與敵方的主戰者分配4點傷害。回復自己的主戰者4點生命值。<br>【策動】使這張卡片的倒數回合數-X。X為「自己的紋章數」。" },
    { id: 318, name: "邁向蒼空之艇", class: "bishop", cost: 4, atk: "N/A", hp: "N/A", image: "images/bi2-2-2.png", desc: "於手牌中發動。當自己進行護符卡的【策動】時，使這張卡片的消費-1。<br>【策動】破壞這張卡片。指定1張自己戰場上進化前的從者卡。使其進化。" },
    { id: 319, name: "給予指引的光輝天使", class: "bishop", cost: 5, atk: "2", hp: "3", image: "images/bi2-2-3.png", desc: "【入場曲】由自己的牌堆中抽取2張卡片。回復自己的主戰者2點生命值。" },
    { id: 320, name: "水之守護神‧莎蕾樺", class: "bishop", cost: 5, atk: "3", hp: "3", image: "images/bi2-2-4.png", desc: "【入場曲】回復自己的主戰者3點生命值。<br>【守護】<br>【進化時】給予敵方戰場上全部的從者卡3點傷害。" },
    { id: 321, name: "潔癖的審判者", class: "bishop", cost: 5, atk: "4", hp: "4", image: "images/bi2-2-5.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。使其消失。" },
    { id: 322, name: "速斷之刃‧阿尼耶絲", class: "bishop", cost: 5, atk: "3", hp: "4", image: "images/bi2-2-6.png", desc: "【疾馳】<br>【攻擊時】如果自己戰場上的護符卡張數為2以上，則會隨機破壞1張敵方戰場上非交戰對象的從者卡。" },
    { id: 323, name: "安息的團結者", class: "bishop", cost: 5, atk: "2", hp: "5", image: "images/bi2-3-1.png", desc: "【入場曲】指定1張敵方戰場上的從者卡。將其破壞。<br>【進化時】使自己獲得『紋章：安息的團結者』。<br>紋章<br>【倒數_4】<br>自己的回合結束時，如果本回合中自己的從者卡未進行攻擊，則會由自己的牌堆中抽取1張生命值為4的從者卡。" },
    { id: 324, name: "治癒的修女", class: "bishop", cost: 6, atk: "3", hp: "5", image: "images/bi2-3-2.png", desc: "【入場曲】回復自己的主戰者5點生命值。<br>【守護】" },
    { id: 325, name: "終焉之白骨聖堂教主", class: "bishop", cost: 6, atk: "4", hp: "4", image: "images/bi2-3-3.png", desc: "【入場曲】破壞自己戰場上全部的護符卡。給予敵方戰場上全部的從者卡與敵方的主戰者X點傷害。X為「這張卡片所破壞的張數」。" },
    { id: 326, name: "哀泣的聖騎士‧維爾伯特", class: "bishop", cost: 6, atk: "4", hp: "6", image: "images/bi2-3-4.png", desc: "【守護】<br>【謝幕曲】召喚2張『聖騎兵』到自己的戰場上。<br>【進化時】使自己獲得『紋章：哀泣的聖騎士‧維爾伯特』。<br>紋章<br>當自己擁有【守護】的從者卡進入戰場時，使其+1/+2。" },
    { id: 327, name: "安息的繼承者‧希彌佳", class: "bishop", cost: 6, atk: "0", hp: "4", image: "images/bi2-3-5.png", desc: "【入場曲】使自己獲得『紋章：安息的繼承者‧希彌佳』。<br>【超進化時】使敵方戰場上全部的從者卡攻擊力轉變為4。<br>紋章<br>【倒數_4】<br>自己的回合結束時，如果自己戰場上有『安息的繼承者‧希彌佳』，則會隨機使X張敵方戰場上攻擊力為4以下的從者卡獲得「無法攻擊從者或主戰者」與「自己的回合結束時，使這張卡片消失」。X為「自己的紋章數」。" },
    { id: 328, name: "銳羽四射", class: "bishop", cost: 6, atk: "N/A", hp: "N/A", image: "images/bi2-3-6.png", desc: "給予敵方戰場上全部的從者卡3點傷害。召喚1張『神聖獵鷹』到自己的戰場上。" },
    { id: 329, name: "邪教之器", class: "bishop", cost: 6, atk: "N/A", hp: "N/A", image: "images/bi2-4-1.png", desc: "【策動】破壞這張卡片。破壞戰場上全部的從者卡。" },
    { id: 330, name: "大地守護神‧宓唯", class: "bishop", cost: 7, atk: "5", hp: "7", image: "images/bi2-4-2.png", desc: "【守護】<br>【謝幕曲】隨機召喚1張與「本次對戰中自己已被破壞且原始消費最高的護符卡」同名的卡片到自己的戰場上。" },
    { id: 331, name: "裁決的弒滅者‧羅德歐", class: "bishop", cost: 7, atk: "5", hp: "5", image: "images/bi2-4-3.png", desc: "【入場曲】指定1張自己手牌中的卡片。將其捨棄。隨機將3種「自己牌堆中消費為3以下的護符卡」召喚到自己的戰場上。<br>【超進化時】隨機破壞1張敵方戰場上攻擊力最高的從者卡。給予敵方戰場上全部的從者卡1點傷害。" },
    { id: 332, name: "天之守護神‧埃忒耳", class: "bishop", cost: 7, atk: "2", hp: "4", image: "images/bi2-4-4.png", desc: "【入場曲】隨機將3種「自己牌堆中消費為3以下的從者卡」召喚到自己的戰場上。<br>【守護】<br>【超進化時】使自己戰場上全部的其他從者卡+0/+2並獲得【光紋】。" },
    { id: 333, name: "聖輝獅鷲獸", class: "bishop", cost: 8, atk: "6", hp: "8", image: "images/bi2-4-5.png", desc: "【守護】<br>當自己進行護符卡的【策動】時，使這張卡片獲得【疾馳】。" },
    { id: 334, name: "崇高的熾天使‧勒碧絲", class: "bishop", cost: 8, atk: "7", hp: "6", image: "images/bi2-4-6.png", desc: "【謝幕曲】使自己獲得『紋章：崇高的熾天使‧勒碧絲』。<br>紋章<br>【倒數_2】<br>【謝幕曲】召喚1張『崇高的熾天使‧勒碧絲』到自己的戰場上。使其獲得【疾馳】。" },
    { id: 335, name: "純白聖女‧貞德", class: "bishop", cost: 8, atk: "6", hp: "6", image: "images/bi2-5-1.png", desc: "【入場曲】給予敵方戰場上全部的從者卡6點傷害。使自己戰場上全部的其他從者卡+2/+4。<br>【守護】" },
    { id: 336, name: "威儀的星晶騎士‧薇拉", class: "bishop", cost: 8, atk: "6", hp: "8", image: "images/bi2-5-2.png", desc: "【入場曲】指定2張敵方戰場上的從者卡。使其消失。【解放奧義】使這張卡片超進化。<br>【守護】<br>受到的傷害為4以上時轉變為3。" },

    { id: 337, name: "熱忱的發明家‧伊俐思", class: "nemesis", cost: 1, atk: "1", hp: "1", image: "images/ne1-1-1.png", desc: "【謝幕曲】增加1張『過往之核』到自己的手牌中。" },
    { id: 338, name: "線偶貓", class: "nemesis", cost: 1, atk: "1", hp: "1", image: "images/ne1-1-2.png", desc: "【入場曲】如果自己戰場上有已超進化的從者卡，則會增加1張『懸絲人偶』到自己的手牌中。使其+3/+0。<br>【突進】" },
    { id: 339, name: "創造物的蓄能", class: "nemesis", cost: 1, atk: "N/A", hp: "N/A", image: "images/ne1-1-3.png", desc: "增加1張『未來之核』與1張『過往之核』到自己的手牌中。" },
    { id: 340, name: "伊卡洛斯的飛翔", class: "nemesis", cost: 1, atk: "N/A", hp: "N/A", image: "images/ne1-1-4.png", desc: "指定1張自己手牌中的創造物‧從者卡。使其獲得【突進】與「【謝幕曲】由自己的牌堆中抽取1張卡片」。" },
    { id: 341, name: "傀儡長槍手", class: "nemesis", cost: 2, atk: "2", hp: "1", image: "images/ne1-1-5.png", desc: "【入場曲】增加1張『改良型‧懸絲人偶』到自己的手牌中。" },
    { id: 342, name: "電鞭揮擊者", class: "nemesis", cost: 2, atk: "1", hp: "3", image: "images/ne1-1-6.png", desc: "【入場曲】增加1張『過往之核』到自己的手牌中。" },
    { id: 343, name: "永彈槍手", class: "nemesis", cost: 2, atk: "2", hp: "2", image: "images/ne1-2-1.png", desc: "【入場曲】增加1張『未來之核』到自己的手牌中。<br>【進化時】指定1張敵方戰場上的從者卡。給予其3點傷害。" },
    { id: 344, name: "執愛的操偶師", class: "nemesis", cost: 2, atk: "2", hp: "2", image: "images/ne1-2-2.png", desc: "【入場曲】增加1張『懸絲人偶』到自己的手牌中。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 345, name: "無心虐殺者‧菲亞", class: "nemesis", cost: 2, atk: "1", hp: "1", image: "images/ne1-2-3.png", desc: "【入場曲】指定1張自己手牌中的人偶‧從者卡。使其變身為『虐殺人偶』。<br>【必殺】" },
    { id: 346, name: "暗獄殘光‧賈絲珀", class: "nemesis", cost: 2, atk: "2", hp: "2", image: "images/ne1-2-4.png", desc: "【入場曲】增加1張『過往之核』到自己的手牌中。<br>【進化時】指定1張自己手牌中的創造物‧從者卡。使其獲得【守護】與「無法被能力破壞」。" },
    { id: 347, name: "破壞的祈禱者", class: "nemesis", cost: 2, atk: "2", hp: "2", image: "images/ne1-2-5.png", desc: "【入場曲】指定1張自己戰場上的其他卡片。如果完成指定，則會將其破壞。隨機給予1張敵方戰場上的從者卡2點傷害。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 348, name: "爆燃的總長‧翼", class: "nemesis", cost: 2, atk: "3", hp: "1", image: "images/ne1-2-6.png", desc: "【入場曲】使自己手牌中全部的奧義量條+1。,br>【突進】" },
    { id: 349, name: "報恩的技師‧艾札克", class: "nemesis", cost: 2, atk: "2", hp: "2", image: "images/ne1-3-1.png", desc: "【謝幕曲】增加1張『進攻的創造物』到自己的手牌中。" },
    { id: 350, name: "生命的奔流", class: "nemesis", cost: 2, atk: "N/A", hp: "N/A", image: "images/ne1-3-2.png", desc: "指定1張敵方戰場上的從者卡。給予其3點傷害。增加1張『過往之核』到自己的手牌中。" },
    { id: 351, name: "殲滅的歌聲", class: "nemesis", cost: 2, atk: "N/A", hp: "N/A", image: "images/ne1-3-3.png", desc: "指定1張自己戰場上的卡片。將其破壞。召喚1張『新約‧白之章』到自己的戰場上。" },
    { id: 352, name: "人偶劇院", class: "nemesis", cost: 2, atk: "N/A", hp: "N/A", image: "images/ne1-3-4.png", desc: "【入場曲】增加1張『懸絲人偶』到自己的手牌中。<br>【倒數_2】<br>自己的回合結束時，增加1張『懸絲人偶』到自己的手牌中。" },
    { id: 353, name: "創造物彈射裝置", class: "nemesis", cost: 2, atk: "N/A", hp: "N/A", image: "images/ne1-3-5.png", desc: "【入場曲】增加1張『未來之核』到自己的手牌中。<br>消費3【策動】破壞這張卡片。指定1張自己手牌中消費為5以下的創造物‧從者卡。將其複製1張並召喚到自己的戰場上。使其獲得「敵方的回合結束時，破壞這張卡片」。" },
    { id: 354, name: "破壞的荒野", class: "nemesis", cost: 2, atk: "N/A", hp: "N/A", image: "images/ne1-3-6.png", desc: "【入場曲】指定1張自己戰場上的其他卡片。如果完成指定，則會將其破壞。由自己的牌堆中抽取2張卡片。<br>【謝幕曲】由自己的牌堆中抽取1張卡片。" },
    { id: 355, name: "砲擊貓獸人", class: "nemesis", cost: 3, atk: "3", hp: "2", image: "images/ne1-4-1.png", desc: "【入場曲】增加1張『未來之核』到自己的手牌中。<br>【突進】" },
    { id: 356, name: "機偶暗殺者", class: "nemesis", cost: 3, atk: "2", hp: "2", image: "images/ne1-4-2.png", desc: "【入場曲】增加1張『改良型‧懸絲人偶』到自己的手牌中。<br>當自己的人偶‧從者卡進入戰場時，每個自己的回合僅限發動1次，使其獲得【必殺】。" },
    { id: 357, name: "決意之志‧米莉亞姆", class: "nemesis", cost: 3, atk: "2", hp: "3", image: "images/ne1-4-3.png", desc: "【入場曲】增加1張『未來之核』與1張『過往之核』到自己的手牌中。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 358, name: "嶄新的少女‧歐絲", class: "nemesis", cost: 3, atk: "3", hp: "3", image: "images/ne1-4-4.png", desc: "【入場曲】由自己的牌堆中抽取1張卡片。<br>【進化時】使自己獲得『紋章：嶄新的少女‧歐絲』。<br>紋章<br>【倒數_3】<br>自己的回合結束時，如果自己手牌中的卡片張數為5以下，則會由自己的牌堆中抽取1張卡片。如果為6以上，則會回復自己的主戰者1點生命值。" },
    { id: 359, name: "破壞的繼承者‧阿克西雅", class: "nemesis", cost: 3, atk: "2", hp: "4", image: "images/ne1-4-5.png", desc: "【守護】<br>無法被能力破壞。<br>【超進化時】給予敵方的主戰者X點傷害。X為「自己戰場上其他卡片的張數」。破壞自己戰場上全部的其他卡片。" },
    { id: 360, name: "重振旗鼓的夜王‧翔", class: "nemesis", cost: 3, atk: "2", hp: "1", image: "images/ne1-4-6.png", desc: "【入場曲】如果為已超進化解禁的回合，則會使這張卡片獲得【障壁】。<br>【疾馳】" },
    { id: 361, name: "人偶替身術", class: "nemesis", cost: 3, atk: "N/A", hp: "N/A", image: "images/ne1-5-1.png", desc: "召喚2張『改良型‧懸絲人偶』到自己的戰場上。" },
    { id: 362, name: "碎石烈槍", class: "nemesis", cost: 3, atk: "N/A", hp: "N/A", image: "images/ne1-5-2.png", desc: "發動6次「隨機給予1張敵方戰場上的從者卡1點傷害」。" },
    { id: 363, name: "奮戰領袖‧露琪娜", class: "nemesis", cost: 4, atk: "3", hp: "3", image: "images/ne1-5-3.png", desc: "【入場曲】增加1張『未來之核』與1張『過往之核』到自己的手牌中。<br>【進化時】召喚1張『進攻的創造物』到自己的戰場上。" },
    { id: 364, name: "破壞的肯定者", class: "nemesis", cost: 4, atk: "4", hp: "4", image: "images/ne1-5-4.png", desc: "【入場曲】使這張卡片+X/+X。X為「自己戰場上其他卡片的張數」。破壞自己戰場上全部的其他卡片。<br>【守護】" },
    { id: 365, name: "奏絕的顯現‧里榭娜", class: "nemesis", cost: 4, atk: "2", hp: "4", image: "images/ne1-5-5.png", desc: "【入場曲】增加1張『奏絕的獨唱』到自己的手牌中。<br>無法被能力破壞。<br>【進化時】召喚1張『新約‧白之章』到自己的戰場上。" },
    { id: 366, name: "異次元的槍擊", class: "nemesis", cost: 4, atk: "", hp: "", image: "images/ne1-5-6.png", desc: "指定1張敵方戰場上的從者卡。將其破壞。增加1張『未來之核』與1張『過往之核』到自己的手牌中。" },
    { id: 367, name: "躍線狂襲", class: "nemesis", cost: 4, atk: "N/A", hp: "N/A", image: "images/ne2-1-1.png", desc: "指定1張敵方戰場上的從者卡。將其破壞。增加2張『懸絲人偶』到自己的手牌中。" },
    { id: 368, name: "魔鋼騎兵", class: "nemesis", cost: 5, atk: "4", hp: "4", image: "images/ne2-1-2.png", desc: "【守護】<br>【進化時】召喚1張『魔鋼騎兵』到自己的戰場上。<br>【超進化時】由原本的1張轉變為2張。" },
    { id: 369, name: "鋼鐵傭兵‧迪爾克", class: "nemesis", cost: 5, atk: "5", hp: "5", image: "images/ne2-1-3.png", desc: "【入場曲】召喚1張『堡壘的創造物』到自己的戰場上。" },
    { id: 370, name: "改境天宮‧亞露愛得", class: "nemesis", cost: 5, atk: "2", hp: "4", image: "images/ne2-1-4.png", desc: "【入場曲】增加1張『未來之核』與1張『過往之核』到自己的手牌中。<br>【進化時】指定1張自己手牌中消費為5以下的創造物‧從者卡。將其複製1張並召喚到自己的戰場上。" },
    { id: 371, name: "絕望君主‧阿紀摩", class: "nemesis", cost: 5, atk: "3", hp: "3", image: "images/ne2-1-5.png", desc: "【進化時】指定1張敵方戰場上攻擊力為4以下的從者卡。使其消失，並將其複製1張後召喚到自己的戰場上。" },
    { id: 372, name: "交響之心‧枷薇", class: "nemesis", cost: 5, atk: "3", hp: "3", image: "images/ne2-1-6.png", desc: "【入場曲】召喚1張『維多利亞』到自己的戰場上。<br>當自己的人偶‧從者卡進入戰場時，使其獲得【守護】。<br>【進化時】召喚1張『改良型‧懸絲人偶』到自己的戰場上。" },
    { id: 373, name: "實地考察的技師", class: "nemesis", cost: 5, atk: "3", hp: "4", image: "images/ne2-2-1.png", desc: "【入場曲】指定1張自己手牌中的卡片。將其捨棄。由自己的牌堆中抽取3張卡片。" },
    { id: 374, name: "轟雷的閃狼‧尤斯堤斯", class: "nemesis", cost: 5, atk: "5", hp: "4", image: "images/ne2-2-2.png", desc: "【入場曲】【奧義】指定1張自己戰場上其他進化前的從者卡。使其與這張卡片進化。<br>【交戰時】給予交戰對象3點傷害。" },
    { id: 375, name: "思慕蒼空的歸還者‧卡希烏斯", class: "nemesis", cost: 5, atk: "3", hp: "2", image: "images/ne2-2-3.png", desc: "【入場曲】指定1張自己手牌中的創造物‧從者卡。給予敵方戰場上全部的從者卡X點傷害。X為「所指定從者卡的攻擊力」。<br>【謝幕曲】增加1張『堡壘的創造物』到自己的手牌中。" },
    { id: 376, name: "光之攝理‧盧歐", class: "nemesis", cost: 5, atk: "6", hp: "6", image: "images/ne2-2-4.png", desc: "【入場曲】發動6次「隨機給予1張敵方戰場上的從者卡1點傷害」。使敵方手牌中全部的從者卡+1/+0。【奧義】使自己獲得『紋章：光之攝理‧盧歐』。<br>紋章<br>【倒數_2】<br>當敵方擁有【疾馳】的從者卡對主戰者進行攻擊時，到回合結束為止，使其-3/-0。" },
    { id: 377, name: "改境的重啟", class: "nemesis", cost: 5, atk: "N/A", hp: "N/A", image: "images/ne2-2-5.png", desc: "指定2張自己手牌中消費為5以下的創造物‧從者卡。將其複製1張並召喚到自己的戰場上。使其獲得「敵方的回合結束時，破壞這張卡片」。" },
    { id: 378, name: "遺產的砲擊", class: "nemesis", cost: 5, atk: "N/A", hp: "N/A", image: "images/ne2-2-6.png", desc: "【入場曲】增加1張『未來之核』到自己的手牌中。<br>當自己進行【融合】時，隨機給予1張敵方戰場上的從者卡2點傷害。" },
    { id: 379, name: "獸性鐵人", class: "nemesis", cost: 6, atk: "4", hp: "9", image: "images/ne2-3-1.png", desc: "【必殺】<br>【守護】" },
    { id: 380, name: "殺意的絲線‧諾亞", class: "nemesis", cost: 6, atk: "5", hp: "6", image: "images/ne2-3-2.png", desc: "【入場曲】增加3張『懸絲人偶』到自己的手牌中。使自己手牌中全部的人偶‧從者卡+1/+0。" },
    { id: 381, name: "箱庭斷罪者‧希爾薇婭", class: "nemesis", cost: 6, atk: "5", hp: "5", image: "images/ne2-3-3.png", desc: "【入場曲】指定1個【模式】並發動該能力。<br>（1）由自己的牌堆中抽取2張卡片。<br>（2）回復自己的主戰者4點生命值。<br>【進化時】指定1張敵方戰場上的從者卡。將其破壞。<br>【超進化時】由原本的1張轉變為2張。" },
    { id: 382, name: "機刃劍士", class: "nemesis", cost: 6, atk: "4", hp: "5", image: "images/ne2-3-4.png", desc: "【入場曲】召喚1張『進攻的創造物』到自己的戰場上。增加1張『過往之核』到自己的手牌中。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 383, name: "心魂武藝‧迦爾拉", class: "nemesis", cost: 6, atk: "5", hp: "4", image: "images/ne2-3-5.png", desc: "【入場曲】指定1張自己手牌中消費為5以下的創造物‧從者卡。將其複製1張並召喚到自己的戰場上。<br>【超進化時】使這張卡片獲得「1回合中可進行2次攻擊」。" },
    { id: 384, name: "破壞的團結者", class: "nemesis", cost: 6, atk: "3", hp: "3", image: "images/ne2-3-6.png", desc: "【入場曲】隨機破壞X張敵方戰場上的從者卡。X為「自己戰場上其他卡片的張數」。破壞自己戰場上全部的其他卡片。" },
    { id: 385, name: "擁心共鬥", class: "nemesis", cost: 6, atk: "N/A", hp: "N/A", image: "images/ne2-4-1.png", desc: "召喚1張『洛伊德』與1張『維多利亞』到自己的戰場上。" },
    { id: 386, name: "混沌軍勢", class: "nemesis", cost: 6, atk: "N/A", hp: "N/A", image: "images/ne2-4-2.png", desc: "給予敵方戰場上全部的從者卡與敵方的主戰者3點傷害。【解放奧義】由原本的3點傷害轉變為6點傷害。" },
    { id: 387, name: "音速的飛行兵", class: "nemesis", cost: 7, atk: "3", hp: "3", image: "images/ne2-4-3.png", desc: "【入場曲】召喚1張『破滅的創造物γ』到自己的戰場上。<br>【進化時】指定1張自己戰場上的創造物‧從者卡。使其+3/+3。" },
    { id: 388, name: "嚴厲的教官‧伊露莎", class: "nemesis", cost: 7, atk: "7", hp: "6", image: "images/ne2-4-4.png", desc: "【入場曲】指定1個【模式】並發動該能力。<br>（1）發動3次「隨機給予1張敵方戰場上的從者卡4點傷害」。<br>（2）給予敵方的主戰者4點傷害。" },
    { id: 389, name: "邁步之心‧奧契絲", class: "nemesis", cost: 8, atk: "5", hp: "5", image: "images/ne2-4-5.png", desc: "【入場曲】召喚1張『洛伊德』到自己的戰場上。<br>當自己的人偶‧從者卡進入戰場時，使其獲得【疾馳】與【必殺】。<br>【超進化時】召喚2張『改良型‧懸絲人偶』到自己的戰場上。" },
    { id: 390, name: "凌光星馳‧洛菈米亞", class: "nemesis", cost: 8, atk: "2", hp: "2", image: "images/ne2-4-6.png", desc: "【入場曲】指定3張自己手牌中消費為5以下的創造物‧從者卡。將其複製1張並召喚到自己的戰場上。<br>【超進化時】使自己戰場上全部的創造物‧從者卡+1/+1。" },
    { id: 391, name: "癲狂創造者‧歷亞姆", class: "nemesis", cost: 9, atk: "7", hp: "7", image: "images/ne2-5-1.png", desc: "【入場曲】召喚3張『改良型‧懸絲人偶』到自己的戰場上。<br>【進化時】使自己戰場上全部的人偶‧從者卡獲得【守護】與「【謝幕曲】給予敵方的主戰者2點傷害」。" },
    { id: 392, name: "統世之王‧巴力巴布", class: "nemesis", cost: 9, atk: "", hp: "", image: "images/ne2-5-2.png", desc: "【入場曲】指定2張敵方戰場上的從者卡。使其失去全部能力。給予其9點傷害。使敵方的主戰者獲得「使受到的傷害+1」。" },

    { id: 393, name: "雙刃哥布林", class: "neutral", cost: 1, atk: "1", hp: "1", image: "images/all-1-1-1.png", desc: "【入場曲】如果自己戰場上有已超進化的從者卡，則會指定1張敵方戰場上的從者卡。給予其4點傷害。" },
    { id: 394, name: "不屈的劍鬥士", class: "neutral", cost: 2, atk: "2", hp: "2", image: "images/all-1-1-2.png", desc: "【爆能強化_4】使這張卡片+3/+3。" },
    { id: 395, name: "叮噹天使‧莉亞", class: "neutral", cost: 2, atk: "0", hp: "4", image: "images/all-1-1-3.png", desc: "【守護】<br>【謝幕曲】由自己的牌堆中抽取1張卡片。<br>【進化時】由自己的牌堆中抽取1張卡片。" },
    { id: 396, name: "貪婪的智天使‧露比", class: "neutral", cost: 2, atk: "2", hp: "2", image: "images/all-1-1-4.png", desc: "【入場曲】指定1張自己手牌中的卡片。使其返回牌堆中。由自己的牌堆中抽取1張卡片。" },
    { id: 397, name: "樂朗天宮‧斐爾特亞", class: "neutral", cost: 2, atk: "2", hp: "2", image: "images/all-1-1-5.png", desc: "【進化時】指定1張敵方戰場上的從者卡。將其破壞。" },
    { id: 398, name: "女僕天使‧伽芮塔", class: "neutral", cost: 2, atk: "2", hp: "2", image: "images/all-1-1-6.png", desc: "【入場曲】如果為已超進化解禁的回合，則會使這張卡片+0/+3。<br>【守護】" },
    { id: 399, name: "雷火雙神‧福尼加爾＆亞文哈爾", class: "neutral", cost: 2, atk: "2", hp: "2", image: "images/all-1-2-1.png", desc: "【爆能強化_5】使這張卡片進化。<br>【謝幕曲】如果這張卡片已進化，則會隨機給予1張敵方戰場上的從者卡4點傷害。" },
    { id: 400, name: "力抗悲嘆的少年", class: "neutral", cost: 2, atk: "1", hp: "3", image: "images/all-1-2-2.png", desc: "於手牌中發動。當敵方的從者卡超進化時，使這張卡片獲得【必殺】。<br>【守護】" },
    { id: 401, name: "惹人憐愛的搭檔‧碧", class: "neutral", cost: 2, atk: "2", hp: "2", image: "images/all-1-2-3.png", desc: "【入場曲】如果為已超進化解禁的回合，則會使這張卡片進化。" },
    { id: 402, name: "掌握蒼空命運的少女‧露莉亞", class: "neutral", cost: 2, atk: "1", hp: "1", image: "images/all-1-2-4.png", desc: "【爆能強化_8】由自己的牌堆中抽取1張消費為7以上的從者卡。回復自己的PP 7點。<br>【障壁】" },
    { id: 403, name: "反轉互換", class: "neutral", cost: 2, atk: "N/A", hp: "N/A", image: "images/all-1-2-5.png", desc: "指定1張戰場上的從者卡。使其+2/-2。" },
    { id: 404, name: "偵探的放大鏡", class: "neutral", cost: 2, atk: "N/A", hp: "N/A", image: "images/all-1-2-6.png", desc: "【策動】破壞這張卡片。指定1張敵方戰場上的從者卡。使其失去【守護】。" },
    { id: 405, name: "煌響使者‧亨莉雅妲", class: "neutral", cost: 3, atk: "3", hp: "3", image: "images/all-1-3-1.png", desc: "【進化時】回復自己的主戰者2點生命值。<br>【超進化時】由原本的回復2點轉變為回復4點。" },
    { id: 406, name: "觀察的偵探", class: "neutral", cost: 3, atk: "3", hp: "3", image: "images/all-1-3-2.png", desc: "【謝幕曲】增加1張『偵探的放大鏡』到自己的手牌中。" },
    { id: 407, name: "飛馳的光明‧阿波羅", class: "neutral", cost: 3, atk: "1", hp: "2", image: "images/all-1-3-3.png", desc: "【入場曲】給予敵方戰場上全部的從者卡1點傷害。<br>【進化時】發動與【入場曲】相同的能力。" },
    { id: 408, name: "颶風天技‧格里姆尼爾", class: "neutral", cost: 3, atk: "2", hp: "3", image: "images/all-1-3-4.png", desc: "【入場曲】使自己獲得『紋章：颶風天技‧格里姆尼爾』。<br>【守護】<br>紋章<br>自己的回合結束時，如果自己戰場上有已超進化的從者卡，則會給予敵方戰場上全部的從者卡2點傷害。" },
    { id: 409, name: "滿懷勇氣的少女", class: "neutral", cost: 3, atk: "3", hp: "1", image: "images/all-1-3-5.png", desc: "於手牌中發動。當敵方的從者卡超進化時，使這張卡片獲得【疾馳】。<br>【突進】" },
    { id: 410, name: "涸絕的顯現‧吉魯涅莉婕", class: "neutral", cost: 3, atk: "0", hp: "3", image: "images/all-1-3-6.png", desc: "【入場曲】指定1張戰場上的其他從者卡。使其+2/-2。如果自己與敵方的PP最大值為10，則會增加1張『涸絕的甘露』到自己的手牌中。<br>【吸血】<br>【進化時】指定1張戰場上的從者卡。使其+2/-2。" },
    { id: 411, name: "柯絲摩斯的使者‧尤妮", class: "neutral", cost: 3, atk: "3", hp: "3", image: "images/all-1-4-1.png", desc: "【光紋】<br>自己的回合結束時，回復自己戰場上全部的從者卡與自己的主戰者1點生命值。" },
    { id: 412, name: "熾天使的福音", class: "neutral", cost: 3, atk: "N/A", hp: "N/A", image: "images/all-1-4-2.png", desc: "由自己的牌堆中抽取2張卡片。" },
    { id: 413, name: "冒險者公會", class: "neutral", cost: 3, atk: "N/A", hp: "N/A", image: "images/all-1-4-3.png", desc: "【入場曲】由自己的牌堆中抽取1張從者卡。<br>【策動】破壞這張卡片。指定1張自己戰場上的從者卡。使其獲得【突進】。" },
    { id: 414, name: "試煉的石板", class: "neutral", cost: 3, atk: "N/A", hp: "N/A", image: "images/all-1-4-4.png", desc: "【入場曲】使自己牌堆中重複的卡片消失，並各自保留1張。<br>【策動】由自己的牌堆中抽取1張卡片。" },
    { id: 415, name: "威撼的歌利亞", class: "neutral", cost: 4, atk: "4", hp: "5", image: "images/all-1-4-5.png", desc: "【守護】" },
    { id: 416, name: "涸絕的使徒", class: "neutral", cost: 4, atk: "2", hp: "2", image: "images/all-1-4-6.png", desc: "【入場曲】指定1張戰場上的其他從者卡。使其+4/-4。" },
    { id: 417, name: "絕大的顯現‧馬塞班恩", class: "neutral", cost: 4, atk: "3", hp: "3", image: "images/all-1-5-1.png", desc: "【入場曲】增加1張『絕大的證明』到自己的手牌中。<br>【進化時】使自己獲得『紋章：絕大的顯現‧馬塞班恩』。<br>紋章<br>當獲得這個紋章時，以【馬塞班恩牌組】取代自己牌堆中的卡片。使自己牌堆底部的死神卡片變身為勝利卡片。<br>自己的回合結束時，捨棄全部自己手牌中非『絕大的證明』的卡片。由自己的牌堆中抽取6張卡片。" },
    { id: 418, name: "邁向蒼空的騎空士‧葛蘭＆吉塔", class: "neutral", cost: 4, atk: "3", hp: "2", image: "images/all-1-5-2.png", desc: "【入場曲】指定1個【模式】並發動該能力。【奧義】使這張卡片進化。<br>（1）隨機給予1張敵方戰場上的從者卡5點傷害。<br>（2）由自己的牌堆中抽取2張從者卡。" },
    { id: 419, name: "神之雷霆", class: "neutral", cost: 4, atk: "N/A", hp: "N/A", image: "images/all-1-5-3.png", desc: "隨機破壞1張敵方戰場上攻擊力最高的從者卡。給予敵方戰場上全部的從者卡1點傷害。" },
    { id: 420, name: "至高的凌駕", class: "neutral", cost: 4, atk: "N/A", hp: "N/A", image: "images/all-1-5-4.png", desc: "由自己的牌堆中抽取3張卡片。如果自己的牌堆中沒有重複的卡片，則會回復自己的PP 3點。" },
    { id: 421, name: "翱翔蒼空的捍衛者‧卡塔莉娜", class: "neutral", cost: 5, atk: "5", hp: "5", image: "images/all-1-5-5.png", desc: "【入場曲】【奧義】隨機給予2張敵方戰場上的從者卡5點傷害。<br>【守護】<br>受到的傷害為4以上時轉變為3。" },
    { id: 422, name: "哥布林的襲擊", class: "neutral", cost: 5, atk: "N/A", hp: "N/A", image: "images/all-1-5-6.png", desc: "召喚5張『哥布林』到自己的戰場上。" },
    { id: 423, name: "天司長的後繼者‧聖德芬", class: "neutral", cost: 6, atk: "7", hp: "6", image: "images/all-2-1-1.png", desc: "於牌堆中發動。自己的回合開始時，如果本次對戰中自己的從者卡進化的次數為6以上，則會【瞬念召喚】這張卡片。<br>當這張卡片被【瞬念召喚】時，使自己獲得『紋章：天司長的後繼者‧聖德芬』。使這張卡片返回手牌中。<br>【入場曲】【解放奧義】發動5次「隨機給予1張敵方戰場上的從者卡或敵方的主戰者2點傷害」。<br>紋章<br>【倒數_2】<br>自己的回合結束時，回復自己戰場上全部的從者卡與自己的主戰者1點生命值。" },
    { id: 424, name: "商隊猛瑪象", class: "neutral", cost: 7, atk: "10", hp: "10", image: "images/all-2-1-2.png", desc: "" },
    { id: 425, name: "毅勇的墮天使‧奧莉薇", class: "neutral", cost: 7, atk: "4", hp: "4", image: "images/all-2-1-3.png", desc: "【入場曲】由自己的牌堆中抽取2張卡片。回復自己的主戰者2點生命值。回復自己的PP 2點。<br>【超進化時】指定1張自己戰場上其他進化前的從者卡。使其超進化。" },
    { id: 426, name: "情誼天使‧蕾娜", class: "neutral", cost: 7, atk: "5", hp: "5", image: "images/all-2-1-4.png", desc: "【進化時】使自己戰場上全部進化前的從者卡進化。" },
    { id: 427, name: "命運的黃昏‧奧丁", class: "neutral", cost: 7, atk: "4", hp: "2", image: "images/all-2-1-5.png", desc: "【入場曲】指定1張敵方戰場上的卡片。使其消失。<br>【疾馳】" },
    { id: 428, name: "終末之罪‧撒旦", class: "neutral", cost: 10, atk: "10", hp: "10", image: "images/all-2-1-6.png", desc: "【入場曲】以【啟示錄牌組】取代自己牌堆中的卡片。" },

];

const grid = document.getElementById('card-grid');

// ==========================================
// 8. 卡片渲染邏輯 (Render Logic)
// ==========================================
// 掛載到 window 以防萬一，但通常由監聽器觸發
window.renderCards = function (filterClass = 'all', filterCost = 'all', searchTerm = '') {
    if (!grid) return;
    grid.innerHTML = '';

    const filtered = cardsData.filter(card => {
        const matchClass = filterClass === 'all' || card.class === filterClass;
        const matchCost = filterCost === 'all' || (filterCost === '7' ? card.cost >= 7 : String(card.cost) === String(filterCost));
        const matchName = card.name.includes(searchTerm);
        return matchClass && matchCost && matchName;
    });

    filtered.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card-item';
        cardEl.innerHTML = `<img src="${card.image}" alt="${card.name}" loading="lazy">`;
        cardEl.addEventListener('click', () => openCardModal(card));
        grid.appendChild(cardEl);
    });
}

const filterClass = document.getElementById('filter-class');
const filterCost = document.getElementById('filter-cost');
const searchInput = document.getElementById('search-input');

if (filterClass && filterCost && searchInput) {
    filterClass.addEventListener('change', (e) => renderCards(e.target.value, filterCost.value, searchInput.value));
    filterCost.addEventListener('change', (e) => renderCards(filterClass.value, e.target.value, searchInput.value));
    searchInput.addEventListener('input', (e) => renderCards(filterClass.value, filterCost.value, e.target.value));
}

// ==========================================
// 9. 統一彈出視窗控制 (Modal Control)
// ==========================================
const cardModal = document.getElementById('card-modal');
const ruleModal = document.getElementById('rule-modal');

function openCardModal(card) {
    document.getElementById('modal-img').src = card.image;
    document.getElementById('modal-name').textContent = card.name;
    document.getElementById('modal-class').textContent = card.class.toUpperCase();
    document.getElementById('modal-cost').textContent = card.cost;
    document.getElementById('modal-atk').textContent = card.atk;
    document.getElementById('modal-hp').textContent = card.hp;
    document.getElementById('modal-desc').innerHTML = card.desc;

    if (cardModal) cardModal.style.display = 'flex';
}

const cardCloseBtn = document.querySelector('#card-modal .close-btn');
if (cardCloseBtn) {
    cardCloseBtn.addEventListener('click', () => {
        cardModal.style.display = 'none';
    });
}

// 掛載到 window
window.openRuleModal = function (ruleKey) {
    const data = rulesData[ruleKey];
    if (data && ruleModal) {
        document.getElementById('rule-modal-title').textContent = data.title;
        document.getElementById('rule-modal-body').innerHTML = data.content;
        ruleModal.style.display = 'flex';
    }
}

// 關閉問題回報 (Firebase 擴充)
window.openReportModal = function () {
    const reportModal = document.getElementById('report-modal');
    if (reportModal) reportModal.style.display = 'flex';
}
window.closeReportModal = function () {
    const reportModal = document.getElementById('report-modal');
    if (reportModal) reportModal.style.display = 'none';
}

const ruleCloseBtn = document.querySelector('#rule-modal .close-btn');
if (ruleCloseBtn) {
    ruleCloseBtn.addEventListener('click', () => {
        ruleModal.style.display = 'none';
    });
}

window.onclick = (e) => {
    if (e.target == cardModal) cardModal.style.display = 'none';
    if (e.target == ruleModal) ruleModal.style.display = 'none';
    const reportModal = document.getElementById('report-modal');
    if (e.target == reportModal) reportModal.style.display = 'none';
}

// ==========================================
// 10. 雷達圖與圖表資料
// ==========================================
let myRadarChart = null;
let myWeeklyChart = null;

function initRadarChart() {
    const ctx = document.getElementById('radarChart');
    if (!ctx) return;

    myRadarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['解場', '打頭', '節奏', '回血', '搓盾'],
            datasets: [{
                label: '能力值',
                data: [0, 0, 0, 0, 0],
                backgroundColor: 'rgba(212, 175, 55, 0.2)',
                borderColor: '#D4AF37',
                borderWidth: 2,
                pointBackgroundColor: '#fff'
            }]
        },
        options: {
            scales: {
                r: {
                    angleLines: { color: '#333' },
                    grid: { color: '#333' },
                    pointLabels: { color: '#e0e0e0', font: { size: 14 } },
                    suggestedMin: 0,
                    suggestedMax: 5,
                    ticks: { display: false, maxTicksLimit: 6 }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// 掛載到 window
window.showRadar = function (dataArray, deckName) {
    if (!myRadarChart) initRadarChart();
    myRadarChart.data.datasets[0].data = dataArray;
    document.getElementById('chart-title').innerHTML = deckName + " 能力分析";
    myRadarChart.update();
}

function initWeeklyChart() {
    const ctx = document.getElementById('radarChartWeekly');
    if (!ctx) return;

    myWeeklyChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['解場', '打頭', '節奏', '回血', '搓盾'],
            datasets: [{
                label: '能力值',
                data: [5, 5, 2, 2, 2],
                backgroundColor: 'rgba(234, 42, 51, 0.2)',
                borderColor: '#ea2a33',
                borderWidth: 2,
                pointBackgroundColor: '#fff'
            }]
        },
        options: {
            scales: {
                r: {
                    angleLines: { color: '#333' },
                    grid: { color: '#333' },
                    pointLabels: { color: '#e0e0e0' },
                    suggestedMin: 0,
                    suggestedMax: 5,
                    ticks: { display: false, maxTicksLimit: 6 }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
}

const weeklyDecksData = {
    'lootroyal': {
        title: '財寶皇 - 運籌帷幄 最強進攻卡組',
        img: 'images/decks/lootroyal.png',
        intro: '難度:困難<br>以財寶系列卡牌獲取財寶，再將財寶活用於各種情況的牌組。因為其不講理的【連續輸出】而穩坐T0位置，但同時也是個【節奏靈活/不穩定】的雙面刃。',
        strat: '起手留換盡量找「3/3/3歐克托莉絲」和任意2費牌，並依照對手的中盤舖場能力考慮抓解場對策。持續累計手牌，當集齊能連續打頭致死的輸出牌後，再連續打出，不留給對方喘息機會。',
        stats: [5, 5, 2, 2, 2]
    },

    'earthwitch': {
        title: '進化土法 - 絕對血量優勢 最強防守卡組',
        img: 'images/decks/earthwitch.png',
        intro: '難度:簡單<br>以土片軸為核心進行解場，再以進化軸斬殺，是【全盤強勢且富續航力】的牌組。【超高回血量】亦是其T0的一大原因。',
        strat: '起手抓能堆土的牌，為「8/5/5拉拉安瑟姆」的無限復活做準備。中盤多利用自動進化牌刷奧義，在「6/7/6聖德芬」解放奧義發動後，便能做到:超進化拉拉安瑟姆過2盾打8、聖德芬打10、法術打2的一回殺戰術。',
        stats: [4, 4, 4, 5, 2]
    },

    'evoroyal': {
        title: '進化皇 - 盤面火力壓制',
        img: 'images/decks/evoroyal.png',
        intro: '難度:簡單<br>從序盤開始【持續壓制】對手，不停考驗對方橫向解場能力。尾盤還能連續做出5隻超進化的大場面，使對方不得不按投降。',
        strat: '起手抓低費牌和「4/4/4王斷天宮」，確保一開始節奏不斷。後續便是不停出功課給對方寫，8費的「6/4/4艾蜜莉亞」+「5/1/3魯米納斯法師」combo，抑或是9費的「4/4/3席耶提」+「5/1/3魯米納斯法師」combo，直到對手不支倒下為止。',
        stats: [4, 3, 5, 2, 4]
    },
    'questbishop': {
        title: '紋章教 - 往日榮光仍在',
        img: 'images/decks/questbishop.png',
        intro: '難度:困難<br>以【紋章數量分配傷害】給對手的牌組。只要將對手的場面解掉，對方主戰者便必須吃下紋章數量的傷害，不停扣血。',
        strat: '起手抓抽牌卡和「3/2/3格里姆尼爾」，並盡量準時拍出「4/4/4瑪文」和「6/4/6維爾伯特」，以最快疊上5個紋章。',
        stats: [3, 2, 3, 4, 5]
    },
    'destroynemesis': {
        title: '破壞仇 - 終焉倒計時',
        img: 'images/decks/destroynemesis.png',
        intro: '難度:普通<br>以破壞自己場上的牌來觸發【破壞自己卡片時】和【被破壞時】效果。兼具穩定回血、打頭且又有爆發，常常能使敵人錯估局勢而被逆轉。',
        strat: '起手全力找抽牌卡和能下蛋的牌，場上有3顆蛋便能穩固勝利。橫向解場較弱，遇到特定職業要提前保留能多解的牌。小心奧丁把蛋插掉。',
        stats: [3, 3, 2, 4, 3]
    },
    'modeabyss': {
        title: '模式夜 - 等我寫完作業',
        img: 'images/decks/modeabyss.png',
        intro: '難度:普通<br>每次進行【模式選擇】能累計信仰，當信仰>=10後，拍出「2/2/2夏姆納可亞」便能永久多選擇一個的選項。',
        strat: '序盤抓低費解場牌，保證在疊信仰時不被偷太多血量。盡量早拍出「2/2/2夏姆納可亞」，已將場面優勢導回己方。後續防斬用「5/4/4團結者」、逼不得已用「9/5/9銀雪夕月」，將高級資源最大利用。',
        stats: [3, 3, 3, 4, 4]
    },
    'rinoelf': {
        title: '蟲妖 - 爆發勢不可擋',
        img: 'images/decks/rinoelf.png',
        intro: '難度:極困難<br>在手牌中累積「0費卡片」，再利用「3/0/2殺戮破魔蟲」的攻擊力=連擊數特性，一回合突破防守，斬殺對方。',
        strat: '起手抓「2費/磷光輝岩」和「3費/聖樹權杖」，一邊解場一邊set斬殺所需的資源。一般而言，本回合能打出的傷害為[甲蟲數量*(費用-甲蟲數量*3+0費牌張數)]。',
        stats: [4, 5, 2, 2, 1]
    },
    'midabyss': {
        title: '中速夜 - 死者軍團',
        img: 'images/decks/midabyss.png',
        intro: '難度:普通<br>以夜魔【高效的鋪場】為核心，在從者戰上贏過對方的牌組。將小優勢以舖場的方式擴大，再以buff場上從者的牌終結對手。',
        strat: '起手抓2費牌穩固墓地和死靈術以利中盤解場，找機會拍下「6/3/3屍骸士兵」和「6/2/7巴薩拉加」得到場面優勢，再以「6/2/4涅槃」或「8/6/6凱爾貝洛斯」提高在場從者攻擊力，直取對手。',
        stats: [2, 3, 4, 4, 4]
    },
    'facedragon': {
        title: '臉龍 - 打頭慾望強烈',
        img: 'images/decks/facedragon.png',
        intro: '難度:超簡單<br>臉龍的臉是【打臉】的意思，顧名思義沒有甚麼好思顧的，打臉就對了。',
        strat: '大哥!!大哥救救我呀!!',
        stats: [2, 5, 3, 2, 3]
    },
    'puppetnemesis': {
        title: '人偶仇 - 蹲得越低...',
        img: 'images/decks/puppetnemesis.png',
        intro: '難度:簡單<br>前期以【人偶】進行穩定解場，尾盤再以【少數爆發牌】一口氣拿下對手。從開服就存在的牌組，卻始終面臨著同樣的問題:我的奧契絲呢?',
        strat: '牌組看似簡單且有不錯的雷達圖數值，其實卻有著高度的不穩定性。5費一定要拍到「5/3/3枷薇」，8費以後盡量拍出「8/5/5奧契絲」等打頭的牌。',
        stats: [4, 4, 3, 2, 4]
    },
    'evodragon': {
        title: '進化龍 - 我賭對面解不掉',
        img: 'images/decks/evodragon.png',
        intro: '難度:簡單<br>類似節奏牌組而更著重於【超進化數量】，將「10/4/4智龍」降費後打出，以獲得盤面優勢，最後以高費終端斬殺對方。',
        strat: '前期以跳費為主，爭取「3/2/1梅格」早點超進化。輔以「7/4/4奧莉薇」雙超進化特性，目的使「10/4/4智龍」降為1甚至0費，一舉改變局勢。',
        stats: [4, 3, 4, 2, 2]
    },
};

// 掛載到 window
window.updateWeeklyView = function (element, deckKey) {
    const data = weeklyDecksData[deckKey];
    if (!data) return;

    document.querySelectorAll('.weekly-tier-list li').forEach(li => {
        li.classList.remove('active');
    });

    element.classList.add('active');

    document.getElementById('weekly-title').textContent = data.title;
    document.getElementById('weekly-img').src = data.img;
    document.getElementById('weekly-intro').innerHTML = data.intro;
    document.getElementById('weekly-strat').innerHTML = data.strat;

    if (!myWeeklyChart) initWeeklyChart();
    else {
        myWeeklyChart.data.datasets[0].data = data.stats;
        myWeeklyChart.update();
    }

    // ★★★ Firebase 功能：呼叫投票系統 ★★★
    loadVotes(deckKey, data.title);
}

// ==========================================
// 11. 規則與歷史資料庫
// ==========================================
const rulesData = {
    'win': {
        title: '勝利條件',
        content: `<p>Shadowverse WB 是一款 1 對 1 的卡牌對戰遊戲。</p><p>雙方主戰者體力皆為 20 點。將對手歸零即可獲勝。</p>`
    },
    'pp': {
        title: 'PP 點數機制',
        content: `<p>PP 每回合回復並增加上限 1 點，最大 10 點。</p>`
    },
    'evo': {
        title: '進化系統',
        content: `<p>先攻第 5 回合 / 後攻第 4 回合可開始進化。</p>`
    },
    'classes': {
        title: '職業特性簡介',
        content: `<ul><li>精靈：連擊</li><li>皇家：協作</li><li>巫師：增幅</li><li>龍族：跳費</li></ul>`
    },
    'hand': {
        title: '手牌上限規則',
        content: `
            <p>遊戲中，雙方玩家的手牌上限皆為 <strong>9 張</strong>。</p>
            <br>
            <p style="color: #ff6b6b;">爆牌 (Overdraw)：</p>
            <p>當你的手牌已有 9 張時，若透過抽牌或效果獲得新卡片，該卡片會直接變成「墓場」並被破壞。</p>
        `
    },
    'win1': {
        title: '牌組限制',
        content: `
        <p>遊戲中，雙方玩家的牌組上限皆為 <strong>40 張</strong>，一種卡片最多存在三張。</p> 
        <br> 
        <p style="color: #ff6b6b;">死神卡片 (Death)：</p> 
        <p>當玩家抽光牌組的40張卡片後，第41張卡片會是<strong>死神卡片</strong>，並直接將玩家判負。</p>`
    },
    'win2': {
        title: '進化點數',
        content: `<p>遊戲中，在進化點解禁回合後，玩家可使用進化點數(玩家主戰者左上方)，使用後可對該張卡片賦予+2/+2與突進效果。如果該卡片有【進化時】，則可觸發該效果</p> `
    },
    'win3': {
        title: '超進化點數', content: `
        <p>遊戲中，在超進化點解禁回合後，玩家可使用超進化點數(玩家主戰者右上方)，使用後可對該張卡片賦予+3/+3與突進效果。並附帶該回合無敵的效果。如果該卡片有【進化時】【超進化時】，則可觸發該效果</p>  `
    },
    'win4': {
        title: '後攻的優勢', content: `
        <p>遊戲中，後手玩家可在1費後/6費後獲得一次該回合PP+1的的權利，未使用無法繼承(即無法PP+2)。</p> `
    },
    'win5': {
        title: '起手牌輪換', content: `
        <p>遊戲中，玩家可在對局開始時拿到<strong>4</strong>張手牌，每張手牌都有一次替換的機會，請謹慎留牌。</p> `
    },
    'win6': {
        title: '奧義', content: `
        <p> 為第四彈新增系統，奧義表示方式為X/ Y，Y為觸發效果所需的既定數值，X表示當前累積數值，為回合數+ 該卡在手牌中時場上累積的進化次數。</p> `
    },
    'win7': {
        title: '紋章', content: `
        <p>最大存在數量為<strong>5</strong>，位於主戰者左方，有些會倒數，有些會永久存在。紋章效果各有好壞。</p> `
    },

};

const historyData = {
    'v3': {
        title: "絕傑的繼承者 推薦牌組",
        decks: [
            {
                name: "馬賽班恩妖精 <br>(マゼルバインエルフ)",
                class: "elf",
                images: ["images/all-1-5-1.png", "images/el1-5-1.png"],
                stats: [3, 1, 4, 3, 3]
            },
            {
                name: "甲蟲妖精 <br>(リノエルフ)",
                class: "elf",
                images: ["images/el1-5-2.png", "images/el1-2-5.png"],
                stats: [5, 5, 1, 1, 1]
            },
            {
                name: "艾茲迪亞妖精 <br>(エズディアエルフ)",
                class: "elf",
                images: ["images/el2-4-6.png", "images/el2-4-5.png"],
                stats: [3, 5, 2, 5, 2]
            },
            {
                name: "財寶皇家 <br>(財宝ロイヤル)",
                class: "royal",
                images: ["images/ro1-5-2.png", "images/ro2-4-1.png"],
                stats: [3, 5, 2, 2, 2]
            },
            {
                name: "混軸巫師 <br>(ハイウィッチ)",
                class: "witch",
                images: ["images/wi2-3-5.png", "images/wi2-4-1.png"],
                stats: [4, 4, 4, 5, 3]
            },
            {
                name: "快攻龍族 <br>(アグロドラゴン)",
                class: "dragon",
                images: ["images/dr2-1-3.png", "images/dr2-2-4.png"],
                stats: [1, 4, 2, 3, 1]
            },
            {
                name: "OTK幻想龍族 <br>(OTKドラゴン)",
                class: "dragon",
                images: ["images/dr2-4-3.png", "images/all-1-5-1.png"],
                stats: [3, 1, 3, 3, 2]
            },
            {
                name: "模式夜魔 <br>(モードナイトメア)",
                class: "abyss",
                images: ["images/ab1-2-4.png", "images/ab2-5-2.png"],
                stats: [3, 3, 4, 5, 5]
            },
            {
                name: "紋章主教 <br>(クレストビショップ)",
                class: "bishop",
                images: ["images/bi2-1-1.png", "images/bi2-1-4.png"],
                stats: [5, 5, 2, 5, 5]
            },
            {
                name: "里榭娜復仇者 <br>(破壊ネメシス)",
                class: "nemesis",
                images: ["images/ne1-5-5.png", "images/ne1-4-5.png"],
                stats: [2, 4, 2, 3, 4]
            },
        ]
    },
    'v2': {
        title: "無限進化 推薦牌組",
        decks: [
            {
                name: "甲蟲妖精 <br>(リノエルフ)",
                class: "elf",
                images: ["images/el1-5-2.png", "images/el1-2-5.png"],
                stats: [5, 5, 1, 1, 1]
            },
            {
                name: "協作皇家 <br>(連携ロイヤル)",
                class: "royal",
                images: ["images/ro2-3-5.png", "images/ro2-5-1.png"],
                stats: [5, 3, 5, 1, 4]
            },
            {
                name: "混軸巫師 <br>(ハイウィッチ)",
                class: "witch",
                images: ["images/wi2-3-5.png", "images/wi2-4-1.png"],
                stats: [4, 5, 4, 5, 3]
            },
            {
                name: "小鳳龍族 <br>(ほーちゃんドラゴン)",
                class: "dragon",
                images: ["images/dr2-4-3.png", "images/dr2-4-5.png"],
                stats: [3, 3, 4, 4, 2]
            },
            {
                name: "控制夜魔 <br>(コントロールナイトメア)",
                class: "abyss",
                images: ["images/ab2-4-1.png", "images/ab2-4-6.png"],
                stats: [4, 1, 4, 3, 4]
            },
            {
                name: "守護主教 <br>(守護ビショップ)",
                class: "bishop",
                images: ["images/bi2-3-4.png", "images/bi2-4-4.png"],
                stats: [2, 1, 5, 3, 5]
            },
            {
                name: "造物復仇者 <br>(アーティファクトネメシス)",
                class: "nemesis",
                images: ["images/ne2-3-5.png", "images/ne2-4-6.png"],
                stats: [3, 3, 3, 4, 2]
            },
            {
                name: "人偶復仇者 <br>(人形ネメシス)",
                class: "nemesis",
                images: ["images/ne2-1-6.png", "images/ne2-4-5.png"],
                stats: [3, 4, 2, 1, 2]
            }
        ]
    },
    'v1': {
        title: "傳說揭幕 推薦牌組",
        decks: [
            {
                name: "甲蟲妖精 <br>(リノエルフ)",
                class: "elf",
                images: ["images/el1-5-2.png", "images/el1-2-5.png"],
                stats: [5, 5, 1, 1, 1]
            },
            {
                name: "中速皇家 <br>(ミッドレンジロイヤル)",
                class: "royal",
                images: ["images/ro2-2-5.png", "images/ro2-3-4.png"],
                stats: [3, 4, 5, 1, 5]
            },
            {
                name: "增幅巫師 <br>(スペルウィッチ)",
                class: "witch",
                images: ["images/wi2-4-1.png", "images/all-2-1-6.png"],
                stats: [4, 5, 4, 3, 4]
            },
            {
                name: "造物復仇者 <br>(アーティファクトネメシス)",
                class: "nemesis",
                images: ["images/ne2-1-4.png", "images/ne2-4-6.png"],
                stats: [4, 4, 5, 4, 1]
            },
            {
                name: "人偶復仇者 <br>(人形ネメシス)",
                class: "nemesis",
                images: ["images/ne2-5-1.png", "images/ne2-4-5.png"],
                stats: [4, 4, 3, 2, 3]
            }

        ]
    }
};

// 掛載到 window
window.switchHistoryVersion = function (element, versionKey) {
    document.querySelectorAll('#history-sidebar li').forEach(li => {
        li.classList.remove('active');
    });
    if (element) element.classList.add('active');

    const data = historyData[versionKey];
    if (!data) {
        console.error("找不到版本資料:", versionKey);
        return;
    }

    const titleEl = document.getElementById('history-title');
    if (titleEl) titleEl.textContent = data.title;

    const container = document.getElementById('history-list-container');
    if (!container) return;

    container.innerHTML = '';

    data.decks.forEach(deck => {
        const deckDiv = document.createElement('div');
        deckDiv.className = 'deck-item';
        deckDiv.onclick = function () {
            showRadar(deck.stats, deck.name);
            // ★★★ Firebase 功能：切換牌組時，載入對應留言 ★★★
            loadComments(deck.name);
        };

        const classMap = { elf: '妖', royal: '皇', witch: '巫', dragon: '龍', abyss: '魔', bishop: '主', nemesis: '仇', neutral: '中' };
        const iconText = classMap[deck.class] || '?';

        const img1 = deck.images[0] || '';
        const img2 = deck.images[1] || '';

        deckDiv.innerHTML = `
    < div class= "deck-icon ${deck.class}" > ${iconText}</div >
        <div class="deck-imgs">
            <img src="${img1}" alt="Deck1">
                <img src="${img2}" alt="Deck2">
                </div>
                <div class="deck-name">${deck.name}</div>
                <span class="arrow-icon">➤</span>
                `;
        container.appendChild(deckDiv);
    });

    if (data.decks.length > 0) {
        showRadar(data.decks[0].stats, data.decks[0].name);
        // ★★★ Firebase 功能：預設載入第一個牌組的留言 ★★★
        loadComments(data.decks[0].name);
    }
}

// ==========================================
// 12. 初始化執行 (Init)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    console.log("System Initialized");

    renderCards();
    initRadarChart();
    initWeeklyChart();
    // 初始化投票圖表 (Firebase)
    initVoteChart();

    // 歷史牌組預設版本
    const firstVer = document.querySelector('#history-sidebar li');
    if (firstVer) {
        switchHistoryVersion(firstVer, 'v3');
    }

    // 本週熱門預設
    const firstWeekly = document.querySelector('.weekly-tier-list li');
    if (firstWeekly) {
        updateWeeklyView(firstWeekly, 'lootroyal');
    }
});