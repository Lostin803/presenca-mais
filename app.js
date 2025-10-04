'use strict';

document.addEventListener('DOMContentLoaded', () => {

// =================================================================================
// CONFIGURAÇÃO E VARIÁVEIS GLOBAIS
// =================================================================================

const IDB_CONFIG = { dbName: 'SchoolManagerDB', storeName: 'SchoolsStore' };
const HANDLE_DB_CONFIG = { dbName: 'AppHandlesDB', storeName: 'HandlesStore', key: 'savedDirectoryHandle' };
const PRESENCA_DB_KEY_PREFIX = 'presencaDB_';

const CRACHA_CONFIG = {
    FONT_FAMILY: 'League Spartan',
    FONT_SIZE: 80, 
    TEXT_COLOR: '#FFFFFF', 
    TEXT_Y_POSITION: 280, 
    TURMA_FONT_SIZE: 40,
    TURMA_TEXT_COLOR: '#FFFFFF',
    TURMA_Y_POSITION: 340,
    BARCODE_POSITION: { x: 75, y: 700 }, 
    BARCODE_SIZE: { width: 481, height: 261 } 
};

let state = {
    activeSchool: null,
    db: null, // DB da escola ativa (SQLite)
    idb: null, // Conexão com o IndexedDB para a lista de escolas
    alunos: [],
    presencas: [],
    selectedAlunoCracha: null,
    directoryHandle: null,
    alunoParaConfirmar: null
};

let newSchoolFiles = { logo: null, db: null, template: null };

// Seletores do DOM
const schoolSelectionScreen = document.getElementById('school-selection-screen');
const mainPanel = document.getElementById('main-panel');
const addSchoolModal = document.getElementById('add-school-modal');
const schoolList = document.getElementById('school-list');
const addSchoolBtn = document.getElementById('add-school-btn');
const schoolSelectionTitle = document.getElementById('school-selection-title');
const addSchoolForm = document.getElementById('add-school-form');
const newSchoolNameInput = document.getElementById('new-school-name');
const selectLogoBtn = document.getElementById('select-logo-btn');
const logoFileNameSpan = document.getElementById('logo-file-name');
const selectTemplateBtn = document.getElementById('select-template-btn');
const templateFileNameSpan = document.getElementById('template-file-name');
const selectDbBtn = document.getElementById('select-db-btn');
const createDbModalBtn = document.getElementById('create-db-modal-btn');
const dbFileNameSpan = document.getElementById('db-file-name');
const cancelModalBtn = document.getElementById('cancel-modal-btn');
const modalStatus = document.getElementById('modal-status');
const schoolNameHeader = document.getElementById('school-name-header');
const dbStatusHeader = document.getElementById('db-status-header');
const changeSchoolBtn = document.getElementById('change-school-btn');
const allTabs = document.querySelectorAll('.tab-link');
const tabContents = document.querySelectorAll('.tab-content');
const barcodeInput = document.getElementById('barcode-input');
const statusPresenca = document.getElementById('status-presenca');
const tabelaAlunosBody = document.getElementById('tabela-alunos-body');
const tabelaPresencaBody = document.getElementById('tabela-presenca-body');
const listaCrachasAlunos = document.getElementById('lista-crachas-alunos');
const crachaCanvas = document.getElementById('cracha-canvas');
const downloadCrachaBtn = document.getElementById('download-cracha-btn');
const downloadTodosCrachasBtn = document.getElementById('download-todos-crachas-btn');
const zipStatus = document.getElementById('zip-status');
const ctx = crachaCanvas.getContext('2d');
const selectFolderBtn = document.getElementById('select-folder-btn');
const folderStatus = document.getElementById('folder-status');
const importDropZone = document.getElementById('import-drop-zone');
const importFileInput = document.getElementById('import-file-input');
const importBrowseBtn = document.getElementById('import-browse-btn');
const importStatus = document.getElementById('import-status');
const exportDbBtn = document.getElementById('export-db-btn');
const addAlunoRowBtn = document.getElementById('add-aluno-row-btn');
const saveManualAlunosBtn = document.getElementById('save-manual-alunos-btn');
const tabelaCadastroManualBody = document.getElementById('tabela-cadastro-manual-body');
const manualCadastroStatus = document.getElementById('manual-cadastro-status');
const searchStudentBtn = document.getElementById('search-student-btn');
const presenceConfirmationArea = document.getElementById('presence-confirmation-area');
const confirmationPhoto = document.getElementById('confirmation-photo');
const confirmationName = document.getElementById('confirmation-name');
const confirmationTurma = document.getElementById('confirmation-turma');
const confirmPresenceBtn = document.getElementById('confirm-presence-btn');
const cancelPresenceBtn = document.getElementById('cancel-presence-btn');

// =================================================================================
// MÓDULO PARA PERSISTIR A PERMISSÃO DA PASTA
// =================================================================================

const openHandleDB = () => new Promise((resolve, reject) => { 
    const request = indexedDB.open(HANDLE_DB_CONFIG.dbName, 1); 
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_DB_CONFIG.storeName); 
    request.onsuccess = () => resolve(request.result); 
    request.onerror = () => reject(request.error); 
});

const saveDirectoryHandle = async (handle) => { 
    const db = await openHandleDB(); 
    const tx = db.transaction(HANDLE_DB_CONFIG.storeName, 'readwrite'); 
    tx.objectStore(HANDLE_DB_CONFIG.storeName).put(handle, HANDLE_DB_CONFIG.key); 
    return tx.complete; 
};

const getSavedDirectoryHandle = async () => { 
    const db = await openHandleDB(); 
    return new Promise((resolve) => { 
        const request = db.transaction(HANDLE_DB_CONFIG.storeName).objectStore(HANDLE_DB_CONFIG.storeName).get(HANDLE_DB_CONFIG.key); 
        request.onsuccess = () => resolve(request.result); 
        request.onerror = () => resolve(null); 
    }); 
};

const verifyDirectoryPermission = async (handle) => { 
    if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true; 
    return await handle.requestPermission({ mode: 'readwrite' }) === 'granted'; 
};

const loadAndVerifySavedHandle = async () => { 
    const savedHandle = await getSavedDirectoryHandle(); 
    if (savedHandle) { 
        if (await verifyDirectoryPermission(savedHandle)) { 
            state.directoryHandle = savedHandle; 
            updateStatus(folderStatus, `Pasta salva "${savedHandle.name}" carregada com sucesso.`, 'success'); 
        } else { 
            updateStatus(folderStatus, `A permissão para a pasta "${savedHandle.name}" foi negada. Por favor, selecione-a novamente.`, 'warning'); 
        } 
    } 
};

// =================================================================================
// LÓGICA DE REGISTRO DE PRESENÇA COM CONFIRMAÇÃO
// =================================================================================

const resetConfirmationArea = () => { 
    state.alunoParaConfirmar = null; 
    presenceConfirmationArea.style.display = 'none'; 
    barcodeInput.value = ''; 
    barcodeInput.focus(); 
    updateStatus(statusPresenca, 'Aguardando leitura...', 'info'); 
};

const buscarEExibirAlunoParaConfirmacao = (codigoBarras) => { 
    const codigoLimpo = String(codigoBarras || '').trim(); 
    if (!codigoLimpo) return; 
    const aluno = state.alunos.find(a => a.Codigo_Barras === codigoLimpo); 
    if (aluno) { 
        state.alunoParaConfirmar = aluno; 
        confirmationName.textContent = aluno.Nome; 
        confirmationTurma.textContent = aluno.Turma; 
        confirmationPhoto.src = aluno.foto ? `data:image/jpeg;base64,${btoa(String.fromCharCode.apply(null, aluno.foto))}` : 'assets/img/placeholder.png'; 
        presenceConfirmationArea.style.display = 'flex'; 
        updateStatus(statusPresenca, `Aluno encontrado. Por favor, confirme a presença.`, 'info'); 
    } else { 
        resetConfirmationArea(); 
        updateStatus(statusPresenca, `Código "${codigoLimpo}" inválido ou aluno não encontrado.`, 'error'); 
    } 
};

const executarRegistroDePresenca = async () => { 
    const aluno = state.alunoParaConfirmar; 
    if (!aluno) return; 
    if (!state.directoryHandle) { 
        updateStatus(statusPresenca, 'ERRO: Vá para "Configurações" e selecione a pasta para salvar as planilhas.', 'error'); 
        return; 
    } 
    const presencaExistente = state.presencas.find(p => p.alunoId === aluno.id); 
    const horaAtual = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); 
    if (presencaExistente) { 
        updateStatus(statusPresenca, `${aluno.Nome} já marcou presença hoje às ${presencaExistente.hora}.`, 'warning'); 
        setTimeout(resetConfirmationArea, 3000); 
    } else { 
        try { 
            updateStatus(statusPresenca, `Registrando ${aluno.Nome}... salvando planilha...`, 'warning'); 
            await atualizarPlanilhaDePresenca(aluno, horaAtual); 
            state.presencas.push({ alunoId: aluno.id, hora: horaAtual }); 
            savePresenceData(); 
            updateStatus(statusPresenca, `Presença registrada para ${aluno.Nome} às ${horaAtual}. Planilha atualizada.`, 'success'); 
            renderPresencaTable(); 
            resetConfirmationArea(); 
        } catch (error) { 
            console.error("Erro no processo de registro:", error); 
            updateStatus(statusPresenca, `Falha ao salvar planilha: ${error.message}`, 'error'); 
        } 
    } 
};

const atualizarPlanilhaDePresenca = async (alunoPresente, horaAtual) => {
    if (!state.directoryHandle) throw new Error("Pasta principal não selecionada.");
    
    const hoje = new Date();
    const nomePastaDia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

    const pastaEscolaHandle = await state.directoryHandle.getDirectoryHandle(
        state.activeSchool.name.replace(/[^a-zA-Z0-9_ -]/g, ''), 
        { create: true }
    );
    const pastaDiaHandle = await pastaEscolaHandle.getDirectoryHandle(nomePastaDia, { create: true });
    
    const nomeTurma = alunoPresente.Turma || "Sem_Turma";
    const nomeArquivo = `${nomeTurma.replace(/[^a-zA-Z0-9_ -]/g, '')}.xlsx`;
    const arquivoHandle = await pastaDiaHandle.getFileHandle(nomeArquivo, { create: true });
    
    let dadosParaPlanilha;
    const arquivo = await arquivoHandle.getFile().catch(() => null);
    
    if (!arquivo || arquivo.size === 0) {
        const todosAlunosDaTurma = state.alunos.filter(a => a.Turma === nomeTurma)
                                                .sort((a, b) => a.Nome.localeCompare(b.Nome));
        dadosParaPlanilha = todosAlunosDaTurma.map(alunoDaLista => ({
            "Nome": alunoDaLista.Nome,
            "Presença": (alunoDaLista.id === alunoPresente.id) ? "SIM" : "NÃO",
            "Hora da Presença": (alunoDaLista.id === alunoPresente.id) ? horaAtual : ""
        }));
    } else {
        const buffer = await arquivo.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let dadosAtuais = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        
        const alunoIndex = dadosAtuais.findIndex(p => p.Nome === alunoPresente.Nome);
        if (alunoIndex !== -1) {
            dadosAtuais[alunoIndex]["Presença"] = "SIM";
            dadosAtuais[alunoIndex]["Hora da Presença"] = horaAtual;
        } else {
            dadosAtuais.push({
                "Nome": alunoPresente.Nome,
                "Presença": "SIM",
                "Hora da Presença": horaAtual
            });
        }
        dadosParaPlanilha = dadosAtuais;
    }
    
    const novaPlanilha = XLSX.utils.json_to_sheet(dadosParaPlanilha);
    const novoWorkbook = XLSX.utils.book_new();
    const nomeAba = nomeTurma.replace(/[\/\\?*[\]]/g, '-').substring(0, 31);
    XLSX.utils.book_append_sheet(novoWorkbook, novaPlanilha, nomeAba);
    
    const saidaBinaria = XLSX.write(novoWorkbook, { bookType: 'xlsx', type: 'array' });
    
    const writable = await arquivoHandle.createWritable();
    await writable.write(new Uint8Array(saidaBinaria));
    await writable.close();
};

// =================================================================================
// FUNÇÕES UTILITÁRIAS, DB, IMPORTAÇÃO E OUTRAS
// =================================================================================

const compressAndConvertToJPEG = (file) => new Promise((resolve, reject) => { 
    const MAX_DIMENSION = 400; 
    const JPEG_QUALITY = 0.8; 
    const reader = new FileReader(); 
    reader.readAsDataURL(file); 
    reader.onload = e => { 
        const img = new Image(); 
        img.src = e.target.result; 
        img.onload = async () => { 
            const canvas = document.createElement('canvas'); 
            const ctx = canvas.getContext('2d'); 
            let { width, height } = img; 
            if (width > height) { 
                if (width > MAX_DIMENSION) { 
                    height *= MAX_DIMENSION / width; 
                    width = MAX_DIMENSION; 
                } 
            } else { 
                if (height > MAX_DIMENSION) { 
                    width *= MAX_DIMENSION / height; 
                    height = MAX_DIMENSION; 
                } 
            } 
            canvas.width = width; 
            canvas.height = height; 
            ctx.drawImage(img, 0, 0, width, height); 
            canvas.toBlob(async blob => { 
                if (!blob) return reject(new Error("Canvas to Blob failed.")); 
                resolve(new Uint8Array(await blob.arrayBuffer())); 
            }, 'image/jpeg', JPEG_QUALITY); 
        }; 
        img.onerror = () => reject(new Error("Invalid image file.")); 
    }; 
    reader.onerror = () => reject(new Error("Failed to read file.")); 
});

const normalizeString = str => {
    if (!str) return '';
    return str.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z0-9\s]/g, '');
};

const initDatabase = async (fileHandle) => {
    const SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}` });
    let db;
    if (fileHandle) {
        try {
            const file = await fileHandle.getFile();
            if (file.size > 0) db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
        } catch (e) {
            console.error("DB file not found, creating new.", e);
        }
    }
    if (!db) {
        db = new SQL.Database();
        db.run(`CREATE TABLE IF NOT EXISTS alunos (
            id TEXT PRIMARY KEY, 
            nome TEXT NOT NULL, 
            turma TEXT NOT NULL, 
            codigo_barra TEXT, 
            foto BLOB,
            nome_normalizado TEXT,
            turma_normalizada TEXT
        );`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_nome_turma_normalizado ON alunos (nome_normalizado, turma_normalizada);`);
    }
    return db;
};

const addAluno = (db, aluno) => {
    const nomeNormalizado = normalizeString(aluno.nome);
    const turmaNormalizada = normalizeString(aluno.turma);
    const stmt = db.prepare("SELECT id FROM alunos WHERE nome_normalizado = ? AND turma_normalizada = ?");
    stmt.bind([nomeNormalizado, turmaNormalizada]);
    const existe = stmt.step();
    stmt.free();
    if (!existe) {
        const insertStmt = db.prepare(`INSERT INTO alunos (id, nome, turma, codigo_barra, nome_normalizado, turma_normalizada) VALUES (?, ?, ?, ?, ?, ?)`);
        insertStmt.run([crypto.randomUUID(), aluno.nome.trim(), aluno.turma.trim(), gerarCodigoBarrasValido(), nomeNormalizado, turmaNormalizada]);
        insertStmt.free();
        return true;
    }
    return false;
};

const getAlunos = (db) => {
    const stmt = db.prepare("SELECT * FROM alunos");
    const alunos = [];
    while (stmt.step()) alunos.push(stmt.getAsObject());
    stmt.free();
    return alunos.map(a => ({ id: a.id, Nome: a.nome, Turma: a.turma, Codigo_Barras: a.codigo_barra, foto: a.foto }));
};

const updateFotoAluno = (db, alunoId, fotoBytes) => { 
    const stmt = db.prepare("UPDATE alunos SET foto = ? WHERE id = ?"); 
    stmt.bind([fotoBytes, alunoId]); 
    stmt.step(); 
    stmt.free(); 
};

const updateAluno = (db, alunoId, novoNome, novaTurma) => {
    const nomeNormalizado = normalizeString(novoNome);
    const turmaNormalizada = normalizeString(novaTurma);
    const stmt = db.prepare("UPDATE alunos SET nome = ?, turma = ?, nome_normalizado = ?, turma_normalizada = ? WHERE id = ?");
    stmt.run([novoNome.trim(), novaTurma.trim(), nomeNormalizado, turmaNormalizada, alunoId]);
    stmt.free();
};

const exportDatabase = (db, schoolName) => { 
    const data = db.export(); 
    const blob = new Blob([data], { type: "application/octet-stream" }); 
    const a = document.createElement("a"); 
    a.href = URL.createObjectURL(blob); 
    a.download = `${schoolName.replace(/ /g, '_')}_backup.db`; 
    a.click(); 
    URL.revokeObjectURL(a.href); 
};

const importFromExcel = (file, db) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            let count = 0;
            let duplicados = 0;
            db.exec("BEGIN TRANSACTION;");
            sheetData.forEach(aluno => {
                const nome = getProp(aluno, ['Nome', 'nome', 'Aluno']);
                const turma = getProp(aluno, ['Turma', 'turma']);
                if (nome && turma) {
                    if (addAluno(db, { nome: String(nome), turma: String(turma) })) count++;
                    else duplicados++;
                }
            });
            db.exec("COMMIT;");
            resolve({ importados: count, duplicados: duplicados });
        } catch (err) {
            db.exec("ROLLBACK;");
            reject(err);
        }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
});

const importFromSQLite = async (file, db) => {
    const SQL = await initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}` });
    const importedDb = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
    const result = importedDb.exec("SELECT nome, turma FROM alunos");
    let novosAlunosCount = 0;
    let duplicados = 0;
    if (result.length > 0) {
        db.exec("BEGIN TRANSACTION;");
        try {
            result[0].values.forEach(data => {
                if (addAluno(db, { nome: data[0], turma: data[1] })) novosAlunosCount++;
                else duplicados++;
            });
            db.exec("COMMIT;");
        } catch (e) {
            db.exec("ROLLBACK;");
            throw e;
        }
    }
    importedDb.close();
    return { importados: novosAlunosCount, duplicados: duplicados };
};

const adicionarLinhaCadastroManual = () => {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text" class="manual-nome" required placeholder="Nome completo do aluno"></td>
        <td><input type="text" class="manual-turma" required placeholder="Turma do aluno"></td>
        <td>
            <div class="foto-cell">
                <label class="foto-upload-btn"><span class="foto-icon">📷</span> Selecionar Foto<input type="file" class="manual-foto" accept="image/*" style="display:none;"></label>
                <span class="file-name-display">Nenhum arquivo</span>
            </div>
        </td>
        <td><button type="button" class="delete-row-btn">Remover</button></td>
    `;
    tabelaCadastroManualBody.appendChild(row);
    const fileInput = row.querySelector('.manual-foto');
    const fileNameDisplay = row.querySelector('.file-name-display');
    fileInput.addEventListener('change', () => { 
        fileNameDisplay.textContent = fileInput.files.length > 0 ? fileInput.files[0].name : 'Nenhum arquivo'; 
    });
};

const salvarAlunosManualmente = async () => {
    // Verificação de segurança: garante que o estado da aplicação não foi perdido.
    if (!state.db || !state.activeSchool) {
        updateStatus(manualCadastroStatus, "ERRO: Nenhuma escola ativa. A aplicação parece ter sido reiniciada. Por favor, selecione a escola novamente.", 'error');
        manualCadastroStatus.style.display = 'block';
        console.error("Tentativa de salvar alunos sem state.db ou state.activeSchool. Isso pode indicar um recarregamento de página inesperado.");
        // Removido: showSchoolSelection(); // Não redireciona mais para tela de seleção
        return;
    }

    const rows = tabelaCadastroManualBody.querySelectorAll('tr');
    if (rows.length === 0) {
        updateStatus(manualCadastroStatus, 'Nenhum aluno na lista para salvar.', 'warning');
        return;
    }

    saveManualAlunosBtn.disabled = true;
    updateStatus(manualCadastroStatus, `Iniciando... Processando ${rows.length} registros.`, 'warning');

    let adicionados = 0, erros = 0, duplicados = 0;

    state.db.exec("BEGIN TRANSACTION;");
    try {
        for (const [index, row] of rows.entries()) {
            const nomeInput = row.querySelector('.manual-nome');
            const turmaInput = row.querySelector('.manual-turma');
            const fotoInput = row.querySelector('.manual-foto');

            nomeInput.style.borderColor = '';
            turmaInput.style.borderColor = '';

            const nome = nomeInput.value.trim();
            const turma = turmaInput.value.trim();

            if (!nome || !turma) {
                erros++;
                if (!nome) nomeInput.style.borderColor = 'red';
                if (!turma) turmaInput.style.borderColor = 'red';
                continue;
            }
            
            updateStatus(manualCadastroStatus, `Salvando ${index + 1}/${rows.length}: ${nome}`, 'warning');

            if (addAluno(state.db, { nome, turma })) {
                adicionados++;
                if (fotoInput.files.length > 0) {
                    try {
                        const fotoFile = fotoInput.files[0];
                        const fotoBytes = await compressAndConvertToJPEG(fotoFile);
                        
                        const stmt = state.db.prepare("SELECT id FROM alunos WHERE nome_normalizado = ? AND turma_normalizada = ?");
                        stmt.bind([normalizeString(nome), normalizeString(turma)]);
                        if (stmt.step()) {
                           updateFotoAluno(state.db, stmt.getAsObject().id, fotoBytes);
                        }
                        stmt.free();
                    } catch (fotoError) {
                        console.error(`Erro ao processar foto para ${nome}:`, fotoError);
                    }
                }
            } else {
                duplicados++;
            }
        }
        state.db.exec("COMMIT;");
    } catch (error) {
        state.db.exec("ROLLBACK;");
        updateStatus(manualCadastroStatus, `Ocorreu um erro crítico. Nenhuma alteração foi salva. Verifique o console.`, 'error');
        console.error("Erro na transação de cadastro manual:", error);
        saveManualAlunosBtn.disabled = false;
        return;
    }

    let msgFinal = `${adicionados} aluno(s) cadastrado(s) com sucesso.`;
    if (duplicados > 0) msgFinal += ` ${duplicados} duplicado(s) ignorado(s).`;
    if (erros > 0) msgFinal += ` ${erros} linha(s) com erro foram ignorada(s).`;
    
    updateStatus(manualCadastroStatus, msgFinal, 'success');
    
    tabelaCadastroManualBody.innerHTML = '';
    state.alunos = getAlunos(state.db);
    renderAll();
    await persistDatabase();
    
    saveManualAlunosBtn.disabled = false;
};


// =================================================================================
// FUNÇÕES PARA PERSISTIR E CARREGAR A BASE DE DADOS (CORRIGIDAS)
// =================================================================================
const openAndSetIDB = () => new Promise((resolve, reject) => {
    if (state.idb) return resolve(state.idb); // Retorna a conexão se já existir
    const request = indexedDB.open(IDB_CONFIG.dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IDB_CONFIG.storeName, { keyPath: 'id' });
    request.onsuccess = () => {
        state.idb = request.result; // Salva a conexão no state
        resolve(state.idb);
    };
    request.onerror = () => reject(request.error);
});

const getSchoolsFromIDB = async () => {
    if (!state.idb) throw new Error("A conexão com IndexedDB não foi estabelecida.");
    return new Promise((resolve) => {
        const tx = state.idb.transaction(IDB_CONFIG.storeName, 'readonly').objectStore(IDB_CONFIG.storeName).getAll();
        tx.onsuccess = () => resolve(tx.result);
    });
};

const saveSchoolToIDB = async (school) => {
    if (!state.idb) throw new Error("A conexão com IndexedDB não foi estabelecida.");
    const tx = state.idb.transaction(IDB_CONFIG.storeName, 'readwrite');
    tx.objectStore(IDB_CONFIG.storeName).put(school);
    return tx.complete;
};

const showMainPanel = () => { 
    schoolSelectionScreen.style.display = 'none'; 
    mainPanel.style.display = 'block'; 
};

const showSchoolSelection = () => { 
    mainPanel.style.display = 'none'; 
    schoolSelectionScreen.style.display = 'block'; 
};

const verifyPermission = async (fileHandle) => { 
    if (!fileHandle) return true; 
    if (await fileHandle.queryPermission({ mode: 'readwrite' }) === 'granted') return true; 
    return await fileHandle.requestPermission({ mode: 'readwrite' }) === 'granted'; 
};

const loadSchool = async (school) => {
    try {
        if (!await verifyPermission(school.dbHandle) || (school.logoHandle && !await verifyPermission(school.logoHandle)) || !await verifyPermission(school.templateHandle)) {
            alert("Permissão de acesso aos arquivos da escola foi negada.");
            return;
        }
        state.db = await initDatabase(school.dbHandle);
        state.alunos = getAlunos(state.db);
        state.activeSchool = school;
        schoolNameHeader.textContent = school.name;
        dbStatusHeader.textContent = `Base: ${school.dbHandle.name}`;
        showMainPanel();
        renderAll();
    } catch (err) {
        console.error(err);
        alert(`Erro ao carregar escola: ${err.message}`);
    }
};

const persistDatabase = async () => {
    if (!state.db || !state.activeSchool?.dbHandle) return false;
    try {
        if (!await verifyPermission(state.activeSchool.dbHandle)) throw new Error("Permissão negada.");
        const data = state.db.export();
        const writable = await state.activeSchool.dbHandle.createWritable();
        await writable.write(data);
        await writable.close();
        return true;
    } catch(err) {
        console.error("Erro ao persistir DB:", err);
        alert(`Falha ao salvar DB: ${err.message}`);
        return false;
    }
};

const renderSchoolList = async () => {
    const schools = await getSchoolsFromIDB();
    schoolList.innerHTML = '';
    
    if (schools.length === 0) {
        schoolList.innerHTML = `<div class="no-schools"><p>Nenhuma escola cadastrada.</p><p>Clique em "Adicionar Escola" para começar.</p></div>`;
        return;
    }

    for (const school of schools) {
        const card = document.createElement('div');
        card.className = 'school-card';
        card.dataset.schoolId = school.id;
        let logoUrl = 'assets/img/logos/default_logo.png';
        if (school.logoHandle) {
            try {
                const file = await school.logoHandle.getFile();
                logoUrl = URL.createObjectURL(file);
            } catch (err) {
                console.warn(`Não foi possível carregar logo da escola ${school.name}:`, err);
            }
        }
        card.innerHTML = `<img src="${logoUrl}" alt="Logo" onload="if(this.src !== 'assets/img/logos/default_logo.png') URL.revokeObjectURL(this.src)"><h3>${school.name}</h3><div class="school-actions"><button class="btn-edit-school">Editar</button><button class="btn-delete-school">Excluir</button></div>`;
        card.addEventListener('click', (e) => {
            if (!e.target.classList.contains('btn-edit-school') && !e.target.classList.contains('btn-delete-school')) loadSchool(school);
        });
        schoolList.appendChild(card);
    }

    document.querySelectorAll('.btn-edit-school').forEach(button => button.addEventListener('click', (e) => {
        e.stopPropagation();
        iniciarEdicaoEscola(e.target.closest('.school-card').dataset.schoolId);
    }));
    document.querySelectorAll('.btn-delete-school').forEach(button => button.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmarExclusaoEscola(e.target.closest('.school-card').dataset.schoolId);
    }));
};

// =================================================================================
// FUNÇÕES PARA EDITAR ESCOLAS
// =================================================================================

const iniciarEdicaoEscola = async (schoolId) => {
    const schools = await getSchoolsFromIDB();
    const school = schools.find(s => s.id === schoolId);
    if (!school) {
        alert('Escola não encontrada.');
        return;
    }
    newSchoolNameInput.value = school.name;
    logoFileNameSpan.textContent = school.logoHandle ? school.logoHandle.name : 'Nenhum arquivo';
    templateFileNameSpan.textContent = school.templateHandle ? school.templateHandle.name : 'Nenhum arquivo';
    dbFileNameSpan.textContent = school.dbHandle ? school.dbHandle.name : 'Nenhum arquivo';
    newSchoolFiles = { logo: school.logoHandle, db: school.dbHandle, template: school.templateHandle };
    addSchoolForm.dataset.editingSchoolId = schoolId;
    document.querySelector('#add-school-modal h2').textContent = 'Editar Escola';
    addSchoolModal.style.display = 'flex';
    modalStatus.style.display = 'none';
};

const salvarEdicaoEscola = async (schoolId) => {
    const schoolName = newSchoolNameInput.value.trim();
    if (!schoolName || !newSchoolFiles.template || !newSchoolFiles.db) {
        updateStatus(modalStatus, "Nome, template e base de dados são obrigatórios.", 'error');
        modalStatus.style.display = 'block';
        return;
    }

    const schools = await getSchoolsFromIDB();
    const schoolIndex = schools.findIndex(s => s.id === schoolId);
    if (schoolIndex === -1) {
        updateStatus(modalStatus, "Escola não encontrada.", 'error');
        modalStatus.style.display = 'block';
        return;
    }

    const updatedSchool = { ...schools[schoolIndex], name: schoolName, logoHandle: newSchoolFiles.logo, dbHandle: newSchoolFiles.db, templateHandle: newSchoolFiles.template };

    try {
        if (!state.idb) throw new Error("Conexão com DB não estabelecida.");
        const tx = state.idb.transaction(IDB_CONFIG.storeName, 'readwrite');
        tx.objectStore(IDB_CONFIG.storeName).put(updatedSchool);
        await tx.complete;

        addSchoolModal.style.display = 'none';
        addSchoolForm.reset();
        delete addSchoolForm.dataset.editingSchoolId;
        logoFileNameSpan.textContent = templateFileNameSpan.textContent = dbFileNameSpan.textContent = 'Nenhum arquivo';
        newSchoolFiles = { logo: null, db: null, template: null };
        document.querySelector('#add-school-modal h2').textContent = 'Adicionar Nova Escola';
        await renderSchoolList();
        
        if (state.activeSchool && state.activeSchool.id === schoolId) {
            await loadSchool(updatedSchool);
        }

        updateStatus(modalStatus, "Escola atualizada com sucesso!", 'success');
        modalStatus.style.display = 'block';
        setTimeout(() => { modalStatus.style.display = 'none'; }, 3000);
    } catch (error) {
        console.error('Erro ao salvar edição:', error);
        updateStatus(modalStatus, `Erro ao salvar: ${error.message}`, 'error');
        modalStatus.style.display = 'block';
    }
};

const confirmarExclusaoEscola = async (schoolId) => {
    if (confirm('Tem certeza que deseja excluir esta escola? Esta ação não pode ser desfeita.')) {
        if (!state.idb) throw new Error("Conexão com DB não estabelecida.");
        const tx = state.idb.transaction(IDB_CONFIG.storeName, 'readwrite');
        tx.objectStore(IDB_CONFIG.storeName).delete(schoolId);
        await tx.complete;
        renderSchoolList();
    }
};

// =================================================================================
// EVENT LISTENERS PRINCIPAIS
// =================================================================================

addSchoolForm.addEventListener('submit', async e => {
    e.preventDefault();
    const editingSchoolId = addSchoolForm.dataset.editingSchoolId;
    if (editingSchoolId) {
        await salvarEdicaoEscola(editingSchoolId);
    } else {
        const schoolName = newSchoolNameInput.value.trim();
        if (!schoolName || !newSchoolFiles.template || !newSchoolFiles.db) {
            updateStatus(modalStatus, "Nome, template e base de dados são obrigatórios.", 'error');
            modalStatus.style.display = 'block';
            return;
        }
        const newSchool = { id: crypto.randomUUID(), name: schoolName, logoHandle: newSchoolFiles.logo, dbHandle: newSchoolFiles.db, templateHandle: newSchoolFiles.template };
        try {
            await saveSchoolToIDB(newSchool);
            addSchoolModal.style.display = 'none';
            addSchoolForm.reset();
            logoFileNameSpan.textContent = templateFileNameSpan.textContent = dbFileNameSpan.textContent = 'Nenhum arquivo';
            newSchoolFiles = { logo: null, db: null, template: null };
            await renderSchoolList();
            updateStatus(modalStatus, "Escola adicionada com sucesso!", 'success');
            modalStatus.style.display = 'block';
            setTimeout(() => { modalStatus.style.display = 'none'; }, 3000);
        } catch (error) {
            updateStatus(modalStatus, `Erro ao adicionar escola: ${error.message}`, 'error');
            modalStatus.style.display = 'block';
        }
    }
});

cancelModalBtn.addEventListener('click', () => {
    addSchoolModal.style.display = 'none';
    addSchoolForm.reset();
    delete addSchoolForm.dataset.editingSchoolId;
    logoFileNameSpan.textContent = templateFileNameSpan.textContent = dbFileNameSpan.textContent = 'Nenhum arquivo';
    newSchoolFiles = { logo: null, db: null, template: null };
    document.querySelector('#add-school-modal h2').textContent = 'Adicionar Nova Escola';
    modalStatus.style.display = 'none';
});

const getTodayKey = () => `${PRESENCA_DB_KEY_PREFIX}${new Date().toISOString().slice(0, 10)}`;
const loadPresenceData = () => { state.presencas = JSON.parse(localStorage.getItem(getTodayKey())) || []; };
const savePresenceData = () => { localStorage.setItem(getTodayKey(), JSON.stringify(state.presencas)); };
const calcularDigitoVerificadorEAN13 = (c) => String((10 - (String(c).split('').reduce((s, d, i) => s + parseInt(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10);
const gerarCodigoBarrasValido = () => { const p = String(Math.floor(1e11 + Math.random() * 9e11)); return p + calcularDigitoVerificadorEAN13(p); };
const getProp = (obj, keys) => { for (const key of keys) { if (obj[key] !== undefined) return obj[key]; } return undefined; };
const updateStatus = (element, message, type) => { element.innerHTML = message; element.className = 'status-box'; if (type) element.classList.add(type); };
const carregarImagem = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`Falha ao carregar: ${src}.`)); img.src = src; });
const limparCanvas = () => { ctx.clearRect(0, 0, crachaCanvas.width, crachaCanvas.height); ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0, 0, crachaCanvas.width, crachaCanvas.height); ctx.fillStyle = '#666'; ctx.textAlign = 'center'; ctx.font = '16px "Segoe UI"'; ctx.fillText("Selecione um aluno", crachaCanvas.width / 2, crachaCanvas.height / 2); };
const gerarCracha = async (aluno) => {
    const { Nome, Turma, Codigo_Barras } = aluno;
    try {
        if (!state.activeSchool?.templateHandle) throw new Error("Template não configurado.");
        const templateFile = await state.activeSchool.templateHandle.getFile();
        const template = await carregarImagem(URL.createObjectURL(templateFile));
        ctx.clearRect(0, 0, crachaCanvas.width, crachaCanvas.height);
        ctx.drawImage(template, 0, 0, crachaCanvas.width, crachaCanvas.height);
        ctx.font = `bold ${CRACHA_CONFIG.FONT_SIZE}px "${CRACHA_CONFIG.FONT_FAMILY}"`;
        ctx.fillStyle = CRACHA_CONFIG.TEXT_COLOR;
        ctx.textAlign = 'center';
        ctx.fillText(Nome, crachaCanvas.width / 2, CRACHA_CONFIG.TEXT_Y_POSITION);
        ctx.font = `${CRACHA_CONFIG.TURMA_FONT_SIZE}px "${CRACHA_CONFIG.FONT_FAMILY}"`;
        ctx.fillStyle = CRACHA_CONFIG.TURMA_TEXT_COLOR;
        ctx.fillText(Turma, crachaCanvas.width / 2, CRACHA_CONFIG.TURMA_Y_POSITION);
        const barcodeCanvas = document.createElement('canvas');
        JsBarcode(barcodeCanvas, Codigo_Barras, { format: "EAN13", margin: 0, displayValue: false, height: 80 });
        ctx.drawImage(barcodeCanvas, CRACHA_CONFIG.BARCODE_POSITION.x, CRACHA_CONFIG.BARCODE_POSITION.y, CRACHA_CONFIG.BARCODE_SIZE.width, CRACHA_CONFIG.BARCODE_SIZE.height);
    } catch (error) {
        console.error(error);
        alert(error.message);
        limparCanvas();
        throw error;
    }
};
const renderAlunosTable = () => {
    tabelaAlunosBody.innerHTML = '';
    if (!state.alunos || state.alunos.length === 0) {
        tabelaAlunosBody.innerHTML = '<tr><td colspan="5">Nenhum aluno carregado.</td></tr>';
        return;
    }
    state.alunos.sort((a, b) => a.Nome.localeCompare(b.Nome)).forEach(aluno => {
        const row = document.createElement('tr');
        row.dataset.alunoId = aluno.id;
        const fotoPreview = aluno.foto ? `<img src="data:image/jpeg;base64,${btoa(String.fromCharCode.apply(null, aluno.foto))}" class="aluno-foto-preview" alt="Foto">` : 'Sem Foto';
        row.innerHTML = `<td data-field="nome">${aluno.Nome}</td><td data-field="turma">${aluno.Turma}</td><td>${aluno.Codigo_Barras}</td><td class="foto-cell">${fotoPreview}<input type="file" class="foto-upload-input" data-aluno-id="${aluno.id}" accept="image/*"></td><td class="actions-cell"><button class="btn btn-small edit-btn" title="Editar"><span style="font-size:1.2em;">✏️</span></button><button class="btn btn-small btn-error delete-btn" title="Excluir"><span style="font-size:1.2em;">🗑️</span></button></td>`;
        tabelaAlunosBody.appendChild(row);
    });
};
const renderPresencaTable = () => {
    tabelaPresencaBody.innerHTML = '';
    if (state.presencas.length === 0) {
        tabelaPresencaBody.innerHTML = '<tr><td colspan="3">Nenhuma presença hoje.</td></tr>';
        return;
    }
    state.presencas.sort((a,b) => b.hora.localeCompare(a.hora)).forEach(p => {
        const aluno = state.alunos.find(a => a.id === p.alunoId);
        if (aluno) {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${aluno.Nome}</td><td>${aluno.Turma}</td><td>${p.hora}</td>`;
            tabelaPresencaBody.appendChild(row);
        }
    });
};
const renderCrachasList = () => {
    listaCrachasAlunos.innerHTML = '';
    state.alunos.sort((a,b) => a.Nome.localeCompare(b.Nome)).forEach(aluno => {
        const li = document.createElement('li');
        li.textContent = `${aluno.Nome} - ${aluno.Turma}`;
        li.dataset.alunoId = aluno.id;
        if(state.selectedAlunoCracha?.id === aluno.id) li.classList.add('selected');
        listaCrachasAlunos.appendChild(li);
    });
};
const renderAll = () => {
    renderAlunosTable();
    renderPresencaTable();
    renderCrachasList();
};

// =================================================================================
// EVENT LISTENERS DA TABELA DE ALUNOS (COM EDIÇÃO DE FOTO INTEGRADA)
// =================================================================================

tabelaAlunosBody.addEventListener('click', async e => {
    // ---- Lógica de Excluir Aluno ----
    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
        const row = deleteBtn.closest('tr');
        if (!row) return;
        const alunoId = row.dataset.alunoId;
        if (confirm('Deseja realmente excluir este aluno?')) {
            try {
                const stmt = state.db.prepare("DELETE FROM alunos WHERE id = ?");
                stmt.run([alunoId]);
                stmt.free();
                await persistDatabase();
                row.style.transition = 'opacity 0.5s';
                row.style.opacity = '0.3';
                setTimeout(() => {
                    state.alunos = getAlunos(state.db);
                    renderAlunosTable();
                    renderCrachasList();
                }, 400);
            } catch (err) {
                alert('Erro ao excluir aluno: ' + err.message);
            }
        }
        return;
    }

    // ---- Lógica de Entrar em Modo de Edição ----
    const editBtn = e.target.closest('.edit-btn');
    if (editBtn) {
        const row = editBtn.closest('tr');
        if (!row || row.classList.contains('editing')) return;
        row.classList.add('editing');

        const nomeCell = row.querySelector('td[data-field="nome"]');
        const turmaCell = row.querySelector('td[data-field="turma"]');
        const fotoCell = row.querySelector('.foto-cell');
        const actionsCell = row.querySelector('.actions-cell');

        row.dataset.originalNome = nomeCell.textContent;
        row.dataset.originalTurma = turmaCell.textContent;
        row.dataset.originalFotoHtml = fotoCell.innerHTML;

        nomeCell.innerHTML = `<input type="text" class="edit-input" value="${nomeCell.textContent}">`;
        turmaCell.innerHTML = `<input type="text" class="edit-input" value="${turmaCell.textContent}">`;
        
        fotoCell.innerHTML = `
            <div class="edit-foto-wrapper">
                <img src="${row.querySelector('.aluno-foto-preview')?.src || 'assets/img/placeholder.png'}" class="edit-foto-preview" alt="Preview">
                <label class="btn btn-small">
                    Alterar Foto
                    <input type="file" class="edit-foto-input" accept="image/*" style="display: none;">
                </label>
            </div>
        `;

        actionsCell.innerHTML = `<button class="btn btn-small btn-success save-btn">Salvar</button><button class="btn btn-small btn-secondary cancel-btn">Cancelar</button>`;
        nomeCell.querySelector('input').focus();
        return;
    }

    // ---- Lógica de Salvar Alterações ----
    const saveBtn = e.target.closest('.save-btn');
    if (saveBtn) {
        const row = saveBtn.closest('tr');
        if (!row) return;
        
        const alunoId = row.dataset.alunoId;
        const novoNome = row.querySelector('td[data-field="nome"] input').value.trim();
        const novaTurma = row.querySelector('td[data-field="turma"] input').value.trim();
        const fotoInput = row.querySelector('.edit-foto-input');

        if (!novoNome || !novaTurma) {
            alert("Nome e Turma não podem ser vazios.");
            return;
        }

        try {
            updateAluno(state.db, alunoId, novoNome, novaTurma);

            if (fotoInput && fotoInput.files.length > 0) {
                const novaFotoFile = fotoInput.files[0];
                const fotoBytes = await compressAndConvertToJPEG(novaFotoFile);
                updateFotoAluno(state.db, alunoId, fotoBytes);
            }

            await persistDatabase();
            
            state.alunos = getAlunos(state.db);
            renderAlunosTable(); 
            renderCrachasList();
            alert("Aluno atualizado com sucesso!");

        } catch (err) {
            alert(`Erro ao salvar: ${err.message}`);
            renderAlunosTable();
        }
        return;
    }

    // ---- Lógica de Cancelar Edição ----
    const cancelBtn = e.target.closest('.cancel-btn');
    if (cancelBtn) {
        const row = cancelBtn.closest('tr');
        if (!row) return;

        row.querySelector('td[data-field="nome"]').textContent = row.dataset.originalNome;
        row.querySelector('td[data-field="turma"]').textContent = row.dataset.originalTurma;
        row.querySelector('.foto-cell').innerHTML = row.dataset.originalFotoHtml;
        row.querySelector('.actions-cell').innerHTML = `<button class="btn btn-small edit-btn" title="Editar"><span style="font-size:1.2em;">✏️</span></button><button class="btn btn-small btn-error delete-btn" title="Excluir"><span style="font-size:1.2em;">🗑️</span></button>`;
        row.classList.remove('editing');
        return;
    }
});

tabelaAlunosBody.addEventListener('change', async e => {
    // ---- Lógica para pré-visualização da foto EM MODO DE EDIÇÃO ----
    if (e.target.classList.contains('edit-foto-input')) {
        const file = e.target.files[0];
        if (file) {
            const previewImg = e.target.closest('.edit-foto-wrapper').querySelector('.edit-foto-preview');
            previewImg.src = URL.createObjectURL(file);
        }
        return;
    }

    // ---- Lógica de upload de foto avulso (fora do modo de edição) ----
    if (e.target.classList.contains('foto-upload-input')) {
        const row = e.target.closest('tr');
        if (row && row.classList.contains('editing')) {
            e.target.value = ''; 
            return;
        }

        const file = e.target.files[0];
        const alunoId = e.target.dataset.alunoId;
        if (file && alunoId && state.db) {
            try {
                const fotoBytes = await compressAndConvertToJPEG(file);
                updateFotoAluno(state.db, alunoId, fotoBytes);
                await persistDatabase();
                state.alunos = getAlunos(state.db);
                renderAlunosTable();
                alert('Foto atualizada com sucesso!');
            } catch (err) {
                alert(`Erro ao salvar foto: ${err.message}`);
            }
        }
    }
});


addSchoolBtn.addEventListener('click', () => { addSchoolModal.style.display = 'flex'; });
changeSchoolBtn.addEventListener('click', async () => {
    showSchoolSelection();
    await renderSchoolList();
});
allTabs.forEach(tab => tab.addEventListener('click', () => {
    allTabs.forEach(item => item.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
}));
selectLogoBtn.addEventListener('click', async () => {
    try {
        const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Imagens', accept: { 'image/*': ['.png', '.jpg', '.jpeg'] } }] });
        newSchoolFiles.logo = handle;
        logoFileNameSpan.textContent = handle.name;
    } catch(e){}
});
selectTemplateBtn.addEventListener('click', async () => {
    try {
        const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Imagens', accept: { 'image/*': ['.png', '.jpg', '.jpeg'] } }] });
        newSchoolFiles.template = handle;
        templateFileNameSpan.textContent = handle.name;
    } catch(e){}
});
selectDbBtn.addEventListener('click', async () => {
    try {
        const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Banco de Dados SQLite', accept: { 'application/x-sqlite3': ['.db', '.sqlite'] } }] });
        newSchoolFiles.db = handle;
        dbFileNameSpan.textContent = handle.name;
    } catch(e){}
});
createDbModalBtn.addEventListener('click', async () => {
    try {
        const handle = await window.showSaveFilePicker({ suggestedName: 'nova_base_alunos.db', types: [{ description: 'Banco de Dados SQLite', accept: { 'application/x-sqlite3': ['.db', '.sqlite'] } }] });
        newSchoolFiles.db = handle;
        dbFileNameSpan.textContent = `(Nova) ${handle.name}`;
    } catch(e){}
});

searchStudentBtn.addEventListener('click', () => buscarEExibirAlunoParaConfirmacao(barcodeInput.value));
barcodeInput.addEventListener('keyup', e => { if (e.key === 'Enter') buscarEExibirAlunoParaConfirmacao(barcodeInput.value); });
confirmPresenceBtn.addEventListener('click', executarRegistroDePresenca);
cancelPresenceBtn.addEventListener('click', resetConfirmationArea);
listaCrachasAlunos.addEventListener('click', e => {
    if (e.target.tagName === 'LI') {
        const alunoId = e.target.dataset.alunoId;
        state.selectedAlunoCracha = state.alunos.find(a => a.id === alunoId);
        if (state.selectedAlunoCracha) {
            gerarCracha(state.selectedAlunoCracha).then(() => {
                downloadCrachaBtn.disabled = false;
                renderCrachasList();
            }).catch(() => { downloadCrachaBtn.disabled = true; });
        }
    }
});
downloadCrachaBtn.addEventListener('click', () => {
    if (state.selectedAlunoCracha) {
        const link = document.createElement('a');
        link.download = `${state.selectedAlunoCracha.Nome.replace(/ /g, '_')}_cracha.png`;
        link.href = crachaCanvas.toDataURL('image/png');
        link.click();
    }
});
downloadTodosCrachasBtn.addEventListener('click', async () => {
    if (state.alunos.length === 0) return;
    const zip = new JSZip();
    downloadTodosCrachasBtn.disabled = true;
    zipStatus.style.display = 'block';
    for (let i = 0; i < state.alunos.length; i++) {
        const aluno = state.alunos[i];
        updateStatus(zipStatus, `Gerando ${i + 1}/${state.alunos.length}: ${aluno.Nome}...`, 'warning');
        try {
            await gerarCracha(aluno);
            const blob = await new Promise(resolve => crachaCanvas.toBlob(resolve, 'image/png'));
            zip.file(`${aluno.Nome.replace(/ /g, '_')}_cracha.png`, blob);
        } catch (err) {
            console.error(`Falha no crachá de ${aluno.Nome}`);
        }
    }
    updateStatus(zipStatus, 'Compactando...', 'warning');
    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = 'crachas.zip';
    link.click();
    URL.revokeObjectURL(link.href);
    updateStatus(zipStatus, 'Download iniciado!', 'success');
    setTimeout(() => { zipStatus.style.display = 'none'; }, 5000);
    downloadTodosCrachasBtn.disabled = false;
    limparCanvas();
});
selectFolderBtn.addEventListener('click', async () => {
    try {
        const handle = await window.showDirectoryPicker({mode: 'readwrite'});
        state.directoryHandle = handle;
        await saveDirectoryHandle(handle);
        updateStatus(folderStatus, `Pasta selecionada e salva: "${handle.name}".`, 'success');
    } catch (err) {
        if (err.name !== 'AbortError') updateStatus(folderStatus, `Erro: ${err.message}`, 'error');
    }
});

const handleImportFile = async file => {
    if (!file) return;
    updateStatus(importStatus, `Processando "${file.name}"...`, 'warning');
    importStatus.style.display = 'block';
    const fileName = file.name.toLowerCase();
    let importFunction = null;
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) importFunction = importFromExcel;
    else if (fileName.endsWith('.db') || fileName.endsWith('.sqlite')) importFunction = importFromSQLite;
    else {
        updateStatus(importStatus, 'Erro: Tipo de arquivo não suportado. Use .xlsx, .db ou .sqlite.', 'error');
        importFileInput.value = '';
        return;
    }
    try {
        const result = await importFunction(file, state.db);
        let mensagem = `${result.importados} novo(s) aluno(s) importado(s)!`;
        if (result.duplicados > 0) mensagem += ` ${result.duplicados} duplicado(s) ignorado(s).`;
        updateStatus(importStatus, mensagem, 'success');
        state.alunos = getAlunos(state.db);
        renderAll();
        await persistDatabase();
    } catch (e) {
        updateStatus(importStatus, `Erro ao importar: ${e.message}`, 'error');
        console.error(e);
    } finally {
        importFileInput.value = '';
    }
};

importBrowseBtn.addEventListener('click', () => importFileInput.click());
importDropZone.addEventListener('click', e => { if(e.target === importDropZone || e.target.tagName === 'P') importFileInput.click() });
importFileInput.addEventListener('change', e => handleImportFile(e.target.files[0]));
importDropZone.addEventListener('dragover', e => { e.preventDefault(); importDropZone.classList.add('dragover'); });
importDropZone.addEventListener('dragleave', () => importDropZone.classList.remove('dragover'));
importDropZone.addEventListener('drop', e => {
    e.preventDefault();
    importDropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleImportFile(e.dataTransfer.files[0]);
});
exportDbBtn.addEventListener('click', async () => {
    if (!state.db || !state.activeSchool) {
        alert('Nenhuma escola ativa.');
        return;
    }
    if (await persistDatabase()) exportDatabase(state.db, state.activeSchool.name);
});
addAlunoRowBtn.addEventListener('click', adicionarLinhaCadastroManual);

saveManualAlunosBtn.addEventListener('click', salvarAlunosManualmente);

tabelaCadastroManualBody.addEventListener('click', e => { 
    if (e.target.classList.contains('delete-row-btn')) {
        e.target.closest('tr').remove(); 
    }
});

// =================================================================================
// INICIALIZAÇÃO DA APLICAÇÃO
// =================================================================================
const init = async () => {
    if (!('showDirectoryPicker' in window && 'indexedDB' in window)) {
        document.body.innerHTML = '<h1>Navegador Incompatível</h1><p>Use Google Chrome ou Edge atualizados.</p>';
        return;
    }
    try {
        await openAndSetIDB();
        await loadAndVerifySavedHandle();
        
        showSchoolSelection();
        await renderSchoolList();
        
        loadPresenceData();
        renderPresencaTable();
        limparCanvas();
    } catch (error) {
        console.error('Erro na inicialização:', error);
        alert('Erro ao carregar a aplicação: ' + error.message);
    }
};

init();

});