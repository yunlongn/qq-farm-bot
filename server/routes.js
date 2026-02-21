/**
 * Express REST API 路由 - 含认证与权限
 */

const express = require('express');
const router = express.Router();
const { botManager } = require('./bot-manager');
const db = require('./database');
const { signToken, hashPassword, authMiddleware, adminOnly, canAccessUin } = require('./auth');
const gameConfig = require('../src/gameConfig');

// ============================================================
//  认证 (不需要 token)
// ============================================================

/** POST /api/auth/login */
router.post('/auth/login', (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ ok: false, error: '用户名和密码不能为空' });

        const user = db.getAdminUser(username);
        if (!user) return res.status(401).json({ ok: false, error: '用户名或密码错误' });

        const hash = hashPassword(password);
        if (hash !== user.password_hash) return res.status(401).json({ ok: false, error: '用户名或密码错误' });

        const token = signToken({
            id: user.id,
            username: user.username,
            role: user.role,
            allowedUins: user.allowed_uins || '',
        });
        res.json({
            ok: true,
            data: {
                token,
                user: { id: user.id, username: user.username, role: user.role, allowedUins: user.allowed_uins },
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** POST /api/auth/register */
router.post('/auth/register', (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ ok: false, error: '用户名和密码不能为空' });
        if (username.length < 2 || username.length > 20) return res.status(400).json({ ok: false, error: '用户名长度 2-20 位' });
        if (password.length < 4) return res.status(400).json({ ok: false, error: '密码至少4位' });
        if (db.getAdminUser(username)) return res.status(400).json({ ok: false, error: '用户名已存在' });

        db.createAdminUser({ username, passwordHash: hashPassword(password), role: 'user' });
        const user = db.getAdminUser(username);
        const token = signToken({
            id: user.id,
            username: user.username,
            role: user.role,
            allowedUins: '',
        });
        res.json({
            ok: true,
            data: {
                token,
                user: { id: user.id, username: user.username, role: user.role, allowedUins: '' },
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** POST /api/auth/change-password */
router.post('/auth/change-password', authMiddleware, (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body || {};
        if (!oldPassword || !newPassword) return res.status(400).json({ ok: false, error: '缺少参数' });
        if (newPassword.length < 4) return res.status(400).json({ ok: false, error: '新密码至少4位' });

        const user = db.getAdminUserById(req.user.id);
        if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });

        if (hashPassword(oldPassword) !== user.password_hash) {
            return res.status(400).json({ ok: false, error: '旧密码错误' });
        }

        db.updateAdminUser(user.id, { password_hash: hashPassword(newPassword) });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** GET /api/auth/me */
router.get('/auth/me', authMiddleware, (req, res) => {
    res.json({ ok: true, data: req.user });
});

// ============================================================
//  以下所有路由需要登录
// ============================================================
router.use(authMiddleware);

// ============================================================
//  账号列表
// ============================================================

/** GET /api/accounts */
router.get('/accounts', (req, res) => {
    try {
        let accounts = botManager.listAccounts();
        if (req.user.role !== 'admin') {
            // 普通用户能看到所有账号，但标记哪些是自己的
            const adminUser = db.getAdminUserById(req.user.id);
            const allowed = (adminUser?.allowed_uins || '').split(',').map(s => s.trim()).filter(Boolean);
            accounts = accounts.map(a => {
                const isOwn = allowed.includes(a.uin);
                if (isOwn) return { ...a, isOwn: true };
                // 非自己的账号：QQ号和昵称脱敏
                const maskedUin = a.uin.slice(0, 3) + '****' + a.uin.slice(-2);
                const maskedNick = a.nickname ? a.nickname.charAt(0) + '***' : '';
                return {
                    ...a,
                    uin: maskedUin,
                    nickname: maskedNick,
                    isOwn: false,
                };
            });
            // 自己的账号排前面
            accounts.sort((a, b) => (b.isOwn ? 1 : 0) - (a.isOwn ? 1 : 0));
        } else {
            accounts = accounts.map(a => ({ ...a, isOwn: true }));
        }
        res.json({ ok: true, data: accounts });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** GET /api/accounts/:uin */
router.get('/accounts/:uin', canAccessUin, (req, res) => {
    try {
        const account = botManager.getAccount(req.params.uin);
        if (!account) return res.status(404).json({ ok: false, error: '账号不存在' });
        res.json({ ok: true, data: account });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ============================================================
//  账号详细数据 (需要 Bot 在运行)
// ============================================================

/** GET /api/accounts/:uin/lands - 土地详细状态 */
router.get('/accounts/:uin/lands', canAccessUin, async (req, res) => {
    try {
        const bot = botManager.bots.get(req.params.uin);
        if (!bot || bot.status !== 'running') {
            return res.status(400).json({ ok: false, error: 'Bot 未运行' });
        }
        const data = await bot.getDetailedLandStatus();
        if (!data) return res.status(500).json({ ok: false, error: '获取土地数据失败' });
        res.json({ ok: true, data });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** GET /api/accounts/:uin/snapshot - 获取详细快照 (含功能开关、统计) */
router.get('/accounts/:uin/snapshot', canAccessUin, (req, res) => {
    try {
        const bot = botManager.bots.get(req.params.uin);
        if (!bot) {
            // 从 DB 返回基础信息
            const user = db.getUserByUin(req.params.uin);
            if (!user) return res.status(404).json({ ok: false, error: '账号不存在' });
            return res.json({
                ok: true, data: {
                    userId: user.uin, status: 'stopped',
                    userState: { name: user.nickname, level: user.level, gold: user.gold, exp: user.exp, gid: user.gid },
                    featureToggles: null, dailyStats: null,
                    preferredSeedId: user.preferred_seed_id || 0,
                }
            });
        }
        res.json({ ok: true, data: bot.getSnapshot() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** PUT /api/accounts/:uin/toggles - 更新功能开关 */
router.put('/accounts/:uin/toggles', canAccessUin, (req, res) => {
    try {
        const bot = botManager.bots.get(req.params.uin);
        if (!bot) return res.status(400).json({ ok: false, error: 'Bot 未运行' });
        bot.setFeatureToggles(req.body || {});
        res.json({ ok: true, data: bot.featureToggles });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ============================================================
//  种植效率排行
// ============================================================

/** GET /api/plant-ranking?level=25 */
router.get('/plant-ranking', (req, res) => {
    try {
        const level = parseInt(req.query.level) || 1;
        const plants = gameConfig.getAllPlants();
        const ranking = [];

        for (const plant of plants) {
            if (!plant.seed_id) continue;

            // 过滤特殊/测试植物（ID 以 2020 开头，如新手引导白萝卜）
            if (String(plant.id).startsWith('2020')) continue;

            const seedItem = gameConfig.getItemInfo(plant.seed_id);
            if (seedItem && seedItem.level_limit && seedItem.level_limit > level) continue;
            // 过滤价格为 0 的免费种子（非正常商店种子）
            if (seedItem && seedItem.price === 0) continue;

            const exp = gameConfig.getPlantExp(plant.id) || 0;
            const growTimeSec = gameConfig.getPlantGrowTime(plant.id) || 0;
            if (growTimeSec <= 0 || exp <= 0) continue;

            const seasons = plant.seasons || 1;

            // 计算多季作物的回生时间（收获后从倒数第二个阶段重新生长）
            let regrowSec = 0;
            if (seasons > 1 && plant.grow_phases) {
                const phases = plant.grow_phases.split(';').filter(p => p.trim());
                const durations = phases.map(seg => {
                    const m = seg.match(/:(\d+)/);
                    return m ? parseInt(m[1]) : 0;
                }).filter(d => d > 0);
                // 回生时间 = 最后一个有效生长阶段的时长
                if (durations.length > 0) {
                    regrowSec = durations[durations.length - 1];
                }
            }

            // 总经验 = 单次收获经验 × 季数
            const totalExp = exp * seasons;
            // 总耗时 = 初始生长时间 + (季数-1) × 回生时间
            const totalTimeSec = growTimeSec + (seasons - 1) * regrowSec;
            const expPerHour = (totalExp / totalTimeSec) * 3600;

            ranking.push({
                id: plant.id,
                name: plant.name,
                seedId: plant.seed_id,
                exp,
                seasons,
                totalExp,
                growTimeSec,
                regrowSec,
                totalTimeSec,
                expPerHour: Math.round(expPerHour * 100) / 100,
            });
        }

        ranking.sort((a, b) => b.expPerHour - a.expPerHour);
        res.json({ ok: true, data: ranking.slice(0, 50) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ============================================================
//  QR 扫码登录
// ============================================================

/** POST /api/accounts/:uin/qr-login */
router.post('/accounts/:uin/qr-login', async (req, res) => {
    try {
        const { uin } = req.params;
        const { platform, farmInterval, friendInterval } = req.body || {};
        const result = await botManager.startQrLogin(uin, { platform, farmInterval, friendInterval });

        // 普通用户添加账号时，自动绑定到该用户
        if (req.user.role !== 'admin') {
            const adminUser = db.getAdminUserById(req.user.id);
            if (adminUser) {
                const currentUins = (adminUser.allowed_uins || '').split(',').map(s => s.trim()).filter(Boolean);
                if (!currentUins.includes(uin)) {
                    currentUins.push(uin);
                    db.updateAdminUser(adminUser.id, { allowed_uins: currentUins.join(',') });
                }
            }
        }

        res.json({ ok: true, data: result });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

/** POST /api/accounts/:uin/qr-cancel */
router.post('/accounts/:uin/qr-cancel', canAccessUin, (req, res) => {
    try {
        botManager.cancelQrLogin(req.params.uin);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// ============================================================
//  Bot 启停
// ============================================================

/** POST /api/accounts/:uin/start */
router.post('/accounts/:uin/start', canAccessUin, async (req, res) => {
    try {
        await botManager.restartBot(req.params.uin);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

/** POST /api/accounts/:uin/stop */
router.post('/accounts/:uin/stop', canAccessUin, async (req, res) => {
    try {
        await botManager.stopBot(req.params.uin);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// ============================================================
//  账号配置
// ============================================================

/** PUT /api/accounts/:uin/config */
router.put('/accounts/:uin/config', canAccessUin, (req, res) => {
    try {
        botManager.updateAccountConfig(req.params.uin, req.body || {});
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

/** DELETE /api/accounts/:uin (管理员或账号拥有者) */
router.delete('/accounts/:uin', canAccessUin, async (req, res) => {
    try {
        await botManager.removeAccount(req.params.uin);

        // 如果是普通用户，从其 allowed_uins 中移除
        if (req.user.role !== 'admin') {
            const adminUser = db.getAdminUserById(req.user.id);
            if (adminUser) {
                const currentUins = (adminUser.allowed_uins || '').split(',').map(s => s.trim()).filter(Boolean);
                const updated = currentUins.filter(u => u !== req.params.uin);
                db.updateAdminUser(adminUser.id, { allowed_uins: updated.join(',') });
            }
        }

        // 广播更新后的账号列表给所有客户端
        const io = req.app.locals.io;
        if (io) io.emit('accounts:list', botManager.listAccounts());
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ============================================================
//  日志
// ============================================================

/** GET /api/accounts/:uin/logs?limit=100 */
router.get('/accounts/:uin/logs', canAccessUin, (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const logs = botManager.getBotLogs(req.params.uin, limit);
        res.json({ ok: true, data: logs });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ============================================================
//  管理员: 用户管理
// ============================================================

/** GET /api/admin/users */
router.get('/admin/users', adminOnly, (req, res) => {
    try {
        const users = db.getAllAdminUsers();
        res.json({ ok: true, data: users });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** POST /api/admin/users */
router.post('/admin/users', adminOnly, (req, res) => {
    try {
        const { username, password, role = 'user', allowedUins = '' } = req.body || {};
        if (!username || !password) return res.status(400).json({ ok: false, error: '用户名和密码不能为空' });
        if (db.getAdminUser(username)) return res.status(400).json({ ok: false, error: '用户名已存在' });
        db.createAdminUser({ username, passwordHash: hashPassword(password), role, allowedUins });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** PUT /api/admin/users/:id */
router.put('/admin/users/:id', adminOnly, (req, res) => {
    try {
        const { role, allowedUins, password } = req.body || {};
        const updates = {};
        if (role !== undefined) updates.role = role;
        if (allowedUins !== undefined) updates.allowed_uins = allowedUins;
        if (password) updates.password_hash = hashPassword(password);
        db.updateAdminUser(parseInt(req.params.id), updates);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** DELETE /api/admin/users/:id */
router.delete('/admin/users/:id', adminOnly, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (id === req.user.id) return res.status(400).json({ ok: false, error: '不能删除自己' });
        db.deleteAdminUser(id);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ============================================================
//  公告
// ============================================================

/** GET /api/announcement */
router.get('/announcement', authMiddleware, (req, res) => {
    try {
        const announcement = db.getAnnouncement();
        res.json({ ok: true, data: announcement || null });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** PUT /api/announcement (管理员) */
router.put('/announcement', adminOnly, (req, res) => {
    try {
        const { title = '', content = '' } = req.body || {};
        if (!content.trim()) return res.status(400).json({ ok: false, error: '公告内容不能为空' });
        const announcement = db.saveAnnouncement({ title: title.trim(), content: content.trim() });
        // 通过 Socket.io 实时推送公告更新
        const io = req.app.locals.io;
        if (io) io.emit('announcement:update', announcement);
        res.json({ ok: true, data: announcement });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
