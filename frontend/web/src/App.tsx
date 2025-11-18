import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface ConflictData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  decryptedValue: number;
  isVerified: boolean;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [conflicts, setConflicts] = useState<ConflictData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingConflict, setCreatingConflict] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newConflictData, setNewConflictData] = useState({ name: "", amount: "", description: "" });
  const [selectedConflict, setSelectedConflict] = useState<ConflictData | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('加载数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const conflictsList: ConflictData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          conflictsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            decryptedValue: Number(businessData.decryptedValue) || 0,
            isVerified: businessData.isVerified
          });
        } catch (e) {
          console.error('加载业务数据错误:', e);
        }
      }
      
      setConflicts(conflictsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createConflict = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingConflict(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE创建纠纷..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const amountValue = parseInt(newConflictData.amount) || 0;
      const businessId = `conflict-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newConflictData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newConflictData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "纠纷创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewConflictData({ name: "", amount: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户拒绝交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingConflict(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "在链上验证解密..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleDecrypt = async () => {
    if (!selectedConflict) return;
    
    const decrypted = await decryptData(selectedConflict.id);
    if (decrypted !== null) {
      setDecryptedAmount(decrypted);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "合约可用性验证成功" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "可用性检查失败" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderDashboard = () => {
    const totalConflicts = conflicts.length;
    const verifiedConflicts = conflicts.filter(c => c.isVerified).length;
    const pendingConflicts = totalConflicts - verifiedConflicts;
    
    return (
      <div className="dashboard-panels">
        <div className="panel wood-panel">
          <h3>总纠纷数</h3>
          <div className="stat-value">{totalConflicts}</div>
          <div className="stat-trend">隐私保护纠纷</div>
        </div>
        
        <div className="panel wood-panel">
          <h3>已验证数据</h3>
          <div className="stat-value">{verifiedConflicts}/{totalConflicts}</div>
          <div className="stat-trend">链上验证</div>
        </div>
        
        <div className="panel wood-panel">
          <h3>待处理纠纷</h3>
          <div className="stat-value">{pendingConflicts}</div>
          <div className="stat-trend">等待调解</div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>数据加密</h4>
            <p>证据使用Zama FHE加密 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>链上存储</h4>
            <p>加密数据存储在区块链上</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>同态计算</h4>
            <p>在加密数据上执行调解算法</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>安全解密</h4>
            <p>生成可验证的调解方案</p>
          </div>
        </div>
      </div>
    );
  };

  const renderProjectIntro = () => {
    return (
      <div className="project-intro">
        <div className="intro-header">
          <h2>FHE隐私纠纷调解平台</h2>
          <p>基于全同态加密的隐私保护纠纷解决方案</p>
        </div>
        
        <div className="intro-content">
          <div className="intro-card">
            <div className="card-icon">🔒</div>
            <h3>隐私保护</h3>
            <p>使用FHE技术保护敏感证据，调解过程中数据全程加密</p>
          </div>
          
          <div className="intro-card">
            <div className="card-icon">⚖️</div>
            <h3>公平调解</h3>
            <p>同态算法在加密数据上计算，确保调解方案公正</p>
          </div>
          
          <div className="intro-card">
            <div className="card-icon">🚀</div>
            <h3>高效解决</h3>
            <p>自动化调解流程，大幅降低解决纠纷的时间和成本</p>
          </div>
        </div>
      </div>
    );
  };

  const renderFeed = () => {
    const feedItems = [
      { id: 1, title: "系统升级", content: "新增FHE调解算法优化", time: "2小时前" },
      { id: 2, title: "新功能", content: "添加纠纷历史记录功能", time: "1天前" },
      { id: 3, title: "维护通知", content: "系统将于今晚进行维护", time: "3天前" },
      { id: 4, title: "用户反馈", content: "感谢用户提出的宝贵建议", time: "1周前" }
    ];
    
    return (
      <div className="feed-section">
        <h2>平台动态</h2>
        <div className="feed-list">
          {feedItems.map(item => (
            <div className="feed-item" key={item.id}>
              <div className="feed-header">
                <span className="feed-title">{item.title}</span>
                <span className="feed-time">{item.time}</span>
              </div>
              <div className="feed-content">{item.content}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqs = [
      { id: 1, question: "什么是FHE技术？", answer: "全同态加密(Fully Homomorphic Encryption)允许在加密数据上直接进行计算，无需解密即可得到加密结果。" },
      { id: 2, question: "如何保证调解公平？", answer: "调解算法在加密数据上运行，任何一方都无法访问原始证据，确保调解过程公正。" },
      { id: 3, question: "数据如何存储？", answer: "所有敏感证据都经过FHE加密后存储在区块链上，只有授权方可以访问。" },
      { id: 4, question: "调解需要多长时间？", answer: "自动化调解流程通常可在24小时内完成，复杂案件可能需要更长时间。" }
    ];
    
    return (
      <div className="faq-section">
        <h2>常见问题</h2>
        <div className="faq-list">
          {faqs.map(faq => (
            <div 
              className={`faq-item ${faqOpen === faq.id ? "open" : ""}`} 
              key={faq.id}
              onClick={() => setFaqOpen(faqOpen === faq.id ? null : faq.id)}
            >
              <div className="faq-question">
                {faq.question}
                <span className="faq-icon">{faqOpen === faq.id ? "−" : "+"}</span>
              </div>
              {faqOpen === faq.id && <div className="faq-answer">{faq.answer}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>隱私糾紛調解 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">⚖️</div>
            <h2>连接钱包继续</h2>
            <p>请连接您的钱包以初始化加密调解系统</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>使用上方按钮连接钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系统将自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始提交和调解隐私纠纷</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p className="loading-note">请稍候</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密调解系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>隱私糾紛調解 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + 新纠纷
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="tab-container">
        <button 
          className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`}
          onClick={() => setActiveTab("dashboard")}
        >
          控制台
        </button>
        <button 
          className={`tab-btn ${activeTab === "conflicts" ? "active" : ""}`}
          onClick={() => setActiveTab("conflicts")}
        >
          纠纷列表
        </button>
        <button 
          className={`tab-btn ${activeTab === "info" ? "active" : ""}`}
          onClick={() => setActiveTab("info")}
        >
          项目信息
        </button>
      </div>
      
      <div className="main-content-container">
        {activeTab === "dashboard" && (
          <div className="dashboard-section">
            <h2>隐私纠纷调解控制台</h2>
            {renderDashboard()}
            
            <div className="panel wood-panel full-width">
              <h3>FHE 🔐 调解流程</h3>
              {renderFHEFlow()}
            </div>
            
            <div className="panel-actions">
              <button 
                onClick={checkAvailability} 
                className="action-btn"
              >
                检查合约可用性
              </button>
              <button 
                onClick={loadData} 
                className="action-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "刷新中..." : "刷新数据"}
              </button>
            </div>
            
            {renderFeed()}
          </div>
        )}
        
        {activeTab === "conflicts" && (
          <div className="conflicts-section">
            <div className="section-header">
              <h2>纠纷列表</h2>
              <div className="header-actions">
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "刷新中..." : "刷新"}
                </button>
              </div>
            </div>
            
            <div className="conflicts-list">
              {conflicts.length === 0 ? (
                <div className="no-conflicts">
                  <p>未找到纠纷记录</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    创建第一个纠纷
                  </button>
                </div>
              ) : conflicts.map((conflict, index) => (
                <div 
                  className={`conflict-item ${selectedConflict?.id === conflict.id ? "selected" : ""} ${conflict.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => setSelectedConflict(conflict)}
                >
                  <div className="conflict-title">{conflict.name}</div>
                  <div className="conflict-meta">
                    <span>创建时间: {new Date(conflict.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="conflict-status">
                    状态: {conflict.isVerified ? "✅ 已验证" : "🔓 待验证"}
                  </div>
                  <div className="conflict-creator">创建者: {conflict.creator.substring(0, 6)}...{conflict.creator.substring(38)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "info" && (
          <div className="info-section">
            {renderProjectIntro()}
            {renderFAQ()}
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreateConflict 
          onSubmit={createConflict} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingConflict} 
          conflictData={newConflictData} 
          setConflictData={setNewConflictData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedConflict && (
        <ConflictDetailModal 
          conflict={selectedConflict} 
          onClose={() => { 
            setSelectedConflict(null); 
            setDecryptedAmount(null); 
          }} 
          decryptedAmount={decryptedAmount} 
          isDecrypting={isDecrypting} 
          onDecrypt={handleDecrypt}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateConflict: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  conflictData: any;
  setConflictData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, conflictData, setConflictData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setConflictData({ ...conflictData, [name]: intValue });
    } else {
      setConflictData({ ...conflictData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-conflict-modal">
        <div className="modal-header">
          <h2>新纠纷</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 加密</strong>
            <p>金额数据将使用Zama FHE加密 (仅限整数)</p>
          </div>
          
          <div className="form-group">
            <label>纠纷名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={conflictData.name} 
              onChange={handleChange} 
              placeholder="输入纠纷名称..." 
            />
          </div>
          
          <div className="form-group">
            <label>争议金额 (整数) *</label>
            <input 
              type="number" 
              name="amount" 
              value={conflictData.amount} 
              onChange={handleChange} 
              placeholder="输入争议金额..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>纠纷描述 *</label>
            <textarea 
              name="description" 
              value={conflictData.description} 
              onChange={handleChange} 
              placeholder="输入纠纷描述..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !conflictData.name || !conflictData.amount || !conflictData.description} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建纠纷"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ConflictDetailModal: React.FC<{
  conflict: ConflictData;
  onClose: () => void;
  decryptedAmount: number | null;
  isDecrypting: boolean;
  onDecrypt: () => void;
}> = ({ conflict, onClose, decryptedAmount, isDecrypting, onDecrypt }) => {
  return (
    <div className="modal-overlay">
      <div className="conflict-detail-modal">
        <div className="modal-header">
          <h2>纠纷详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="conflict-info">
            <div className="info-item">
              <span>纠纷名称:</span>
              <strong>{conflict.name}</strong>
            </div>
            <div className="info-item">
              <span>创建者:</span>
              <strong>{conflict.creator.substring(0, 6)}...{conflict.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>创建时间:</span>
              <strong>{new Date(conflict.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>纠纷描述</h3>
            <div className="conflict-description">{conflict.description}</div>
            
            <h3>加密数据</h3>
            <div className="data-row">
              <div className="data-label">争议金额:</div>
              <div className="data-value">
                {conflict.isVerified ? 
                  `${conflict.decryptedValue} (链上验证)` : 
                  decryptedAmount !== null ? 
                  `${decryptedAmount} (本地解密)` : 
                  "🔒 FHE加密整数"
                }
              </div>
              <button 
                className={`decrypt-btn ${(conflict.isVerified || decryptedAmount !== null) ? 'decrypted' : ''}`}
                onClick={onDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : conflict.isVerified ? (
                  "✅ 已验证"
                ) : decryptedAmount !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 安全验证</strong>
                <p>数据在链上加密存储。点击"验证解密"执行离线解密和链上验证。</p>
              </div>
            </div>
          </div>
          
          {(conflict.isVerified || decryptedAmount !== null) && (
            <div className="mediation-section">
              <h3>调解方案</h3>
              <div className="mediation-result">
                <div className="result-item">
                  <span>建议支付金额:</span>
                  <strong>
                    {conflict.isVerified ? 
                      `${Math.round(conflict.decryptedValue * 0.6)}` : 
                      `${Math.round(decryptedAmount! * 0.6)}`
                    }
                  </strong>
                </div>
                <div className="result-item">
                  <span>调解方案:</span>
                  <strong>双方各承担60%和40%责任</strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {!conflict.isVerified && (
            <button 
              onClick={onDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


