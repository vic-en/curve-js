import { ethers, Contract} from "ethers";
import { curve } from "../curve.js";
import { getPool } from "../pools/index.js";
import { parseUnits, BN, mulBy1_3, getPoolIdBySwapAddress } from "../utils.js";
import CurveLpTokenV5ABI from "../constants/abis/curve_lp_token_v5.json" assert { type: 'json' };
import Plain2ETHOracleABIABI from "../constants/abis/factory-v2/Plain2ETHOracle.json" assert { type: 'json' };


// ------- STABLE PLAIN POOLS -------


const _deployStablePlainPool = async (
    name: string,
    symbol: string,
    coins: string[],
    A: number | string,
    fee: number | string, // %
    assetType: 0 | 1 | 2 | 3, // 0 = USD, 1 = ETH, 2 = BTC, 3 = Other
    implementationIdx: 0 | 1 | 2 | 3 | 4 | 5,
    emaTime: number, // seconds
    oracleAddress: string,
    methodName: string,
    estimateGas: boolean
): Promise<ethers.ContractTransactionResponse | number> => {
    if (name.length > 32) throw Error("Max name length = 32");
    if (symbol.length > 10) throw Error("Max symbol length = 10");
    if (![2, 3, 4].includes(coins.length)) throw Error("Invalid number of coins. Must be 2, 3 or 4");
    if (BN(fee).lt(0.04)) throw Error(`fee must be >= 0.04%. Passed fee = ${fee}`);
    if (BN(fee).gt(1)) throw Error(`fee must be <= 1%. Passed fee = ${fee}`);
    if (![0, 1, 2, 3].includes(assetType)) throw Error("Invalid assetType. Must be one of: 0 = USD, 1 = ETH, 2 = BTC, 3 = Other");
    if (curve.chainId !== 1 || coins.length > 2) {
        if (![0, 1, 2, 3].includes(implementationIdx)) throw Error("Invalid implementationIdx. Must be one 0, 1, 2 or 3");
    } else {
        if (![0, 1, 2, 3, 4, 5].includes(implementationIdx)) throw Error("Invalid implementationIdx. Must be one 0, 1, 2, 3, 4 or 5");
    }
    if (emaTime <= 0) throw Error(`emaTime must be > 0. Passed emaTime = ${emaTime}`);

    const _A = parseUnits(A, 0);
    const _fee = parseUnits(fee, 8);
    const _coins = coins.concat(Array(4 - coins.length).fill(curve.constants.ZERO_ADDRESS));

    const useProxy = (curve.chainId === 1 && coins.length === 2 && implementationIdx === 4 && emaTime !== 600) ||
        (curve.chainId === 1 && coins.length === 2 && implementationIdx === 5 && emaTime !== 600) ||
        ((curve.chainId === 42161 || curve.chainId == 10) && coins.length === 2 && implementationIdx === 0 && emaTime !== 600);
    const setOracle = ((curve.chainId === 42161 || curve.chainId == 10) && coins.length === 2 && implementationIdx === 2);

    const contractAddress = (useProxy || setOracle) ? curve.constants.ALIASES.factory_admin : curve.constants.ALIASES.factory;
    const contract = curve.contracts[contractAddress].contract;
    const args = [name, symbol, _coins, _A, _fee, assetType, implementationIdx];
    if (useProxy || setOracle) args.push(parseUnits(Math.floor(emaTime / Math.log(2)), 0));
    if (setOracle) {
        const methodId = methodName === "0x00000000" ? "0x00000000" : ethers.id(methodName).substring(0, 10);
        args.push(methodId, oracleAddress);
    }
    const methodToCall = setOracle ? "deploy_plain_pool_and_set_oracle" : "deploy_plain_pool";
    const gas = await contract[methodToCall].estimateGas(...args, curve.constantOptions);
    if (estimateGas) return Number(gas);

    const gasLimit = mulBy1_3(gas);
    await curve.updateFeeData();
    return await contract[methodToCall](...args, { ...curve.options, gasLimit });
}

export const deployStablePlainPoolEstimateGas = async (
    name: string,
    symbol: string,
    coins: string[],
    A: number | string,
    fee: number | string, // %
    assetType: 0 | 1 | 2 | 3, // 0 = USD, 1 = ETH, 2 = BTC, 3 = Other
    implementationIdx: 0 | 1 | 2 | 3 | 4 | 5,
    emaTime = 600, // seconds
    oracleAddress = curve.constants.ZERO_ADDRESS,
    methodName = "0x00000000"
): Promise<number> => {
    return await _deployStablePlainPool(name, symbol, coins, A, fee, assetType, implementationIdx, emaTime, oracleAddress, methodName, true) as number;
}

export const deployStablePlainPool = async (
    name: string,
    symbol: string,
    coins: string[],
    A: number | string,
    fee: number | string, // %
    assetType: 0 | 1 | 2 | 3, // 0 = USD, 1 = ETH, 2 = BTC, 3 = Other
    implementationIdx: 0 | 1 | 2 | 3 | 4 | 5,
    emaTime = 600, // seconds
    oracleAddress = curve.constants.ZERO_ADDRESS,
    methodName = "0x00000000"
): Promise<ethers.ContractTransactionResponse> => {
    return await _deployStablePlainPool(name, symbol, coins, A, fee, assetType, implementationIdx, emaTime, oracleAddress, methodName, false) as ethers.ContractTransactionResponse;
}

export const getDeployedStablePlainPoolAddress = async (tx: ethers.ContractTransactionResponse): Promise<string> => {
    const txInfo = await tx.wait();
    if (!txInfo) throw Error("Can't get tx info");
    return txInfo.logs[0].address.toLowerCase();
}

export const _setOracle = async (poolAddress: string, oracleAddress: string, methodName: string, estimateGas: boolean): Promise<ethers.ContractTransactionResponse | number> => {
    curve.setContract(poolAddress, Plain2ETHOracleABIABI);
    const poolContract = curve.contracts[poolAddress].contract;
    const methodId = methodName === "0x00000000" ? "0x00000000" : ethers.id(methodName).substring(0, 10);
    const _gas =  await poolContract.set_oracle.estimateGas(methodId, oracleAddress, curve.constantOptions);
    if (estimateGas) return Number(_gas);

    const gasLimit = mulBy1_3(_gas);
    await curve.updateFeeData();
    return await poolContract.set_oracle(methodId, oracleAddress, { ...curve.options, gasLimit });
}

export const setOracleEstimateGas = async (poolAddress: string, oracleAddress = curve.constants.ZERO_ADDRESS, methodName = "0x00000000"): Promise<number> => {
    return await _setOracle(poolAddress, oracleAddress, methodName, true) as number;
}

export const setOracle = async (poolAddress: string, oracleAddress = curve.constants.ZERO_ADDRESS, methodName = "0x00000000"): Promise<ethers.ContractTransactionResponse> => {
    return await _setOracle(poolAddress, oracleAddress, methodName, false) as ethers.ContractTransactionResponse;
}

// ------- STABLE META POOLS -------

const _deployStableMetaPool = async (
    basePool: string,
    name: string,
    symbol: string,
    coin: string,
    A: number | string,
    fee: number | string, // %
    implementationIdx: 0 | 1,
    estimateGas: boolean
): Promise<ethers.ContractTransactionResponse | number> => {
    if (name.length > 32) throw Error("Max name length = 32");
    if (symbol.length > 10) throw Error("Max symbol length = 10");
    if (BN(fee).lt(0.04)) throw Error(`fee must be >= 0.04%. Passed fee = ${fee}`);
    if (BN(fee).gt(1)) throw Error(`fee must be <= 1%. Passed fee = ${fee}`);
    if (![0, 1].includes(implementationIdx)) throw Error("Invalid implementationIdx. Must be one 0 or 1");

    const _A = parseUnits(A, 0);
    const _fee = parseUnits(fee, 8);

    const contract = curve.contracts[curve.constants.ALIASES.factory].contract;
    const gas = await contract.deploy_metapool.estimateGas(basePool, name, symbol, coin, _A, _fee, implementationIdx, curve.constantOptions);
    if (estimateGas) return Number(gas);

    const gasLimit = mulBy1_3(gas);
    await curve.updateFeeData();
    return await contract.deploy_metapool(basePool, name, symbol, coin, _A, _fee, implementationIdx, { ...curve.options, gasLimit });
}

export const deployStableMetaPoolEstimateGas = async (
    basePool: string,
    name: string,
    symbol: string,
    coin: string,
    A: number | string,
    fee: number | string, // %
    implementationIdx: 0 | 1
): Promise<number> => {
    return await _deployStableMetaPool(basePool, name, symbol, coin, A, fee, implementationIdx, true) as number;
}

export const deployStableMetaPool = async (
    basePool: string,
    name: string,
    symbol: string,
    coin: string,
    A: number | string,
    fee: number | string, // %
    implementationIdx: 0 | 1
): Promise<ethers.ContractTransactionResponse> => {
    return await _deployStableMetaPool(basePool, name, symbol, coin, A, fee, implementationIdx, false) as ethers.ContractTransactionResponse;
}

export const getDeployedStableMetaPoolAddress = async (tx: ethers.ContractTransactionResponse): Promise<string> => {
    const txInfo = await tx.wait();
    if (!txInfo) throw Error("Can't get tx info");
    for (let i = txInfo.logs.length - 1; i > -1; i--) {
        if ("args" in txInfo.logs[i]) {
            const basePoolId = getPoolIdBySwapAddress((txInfo.logs[i] as ethers.EventLog).args[1]);
            const basePool = getPool(basePoolId);
            return txInfo.logs[basePool.underlyingCoins.length].address.toLowerCase();
        }
    }
    throw Error("Can't get deployed metapool address");
}


// ------- CRYPTO POOLS -------


const _deployCryptoPool = async (
    name: string,
    symbol: string,
    coins: string[],
    A: number | string,
    gamma: number | string,
    midFee: number | string, // %
    outFee: number | string, // %
    allowedExtraProfit: number | string,
    feeGamma: number | string,
    adjustmentStep: number | string,
    maHalfTime: number, // Seconds
    initialPrice: number | string,
    estimateGas: boolean
): Promise<ethers.ContractTransactionResponse | number> => {
    if (name.length > 32) throw Error("Max name length = 32");
    if (symbol.length > 10) throw Error("Max symbol length = 10");
    if (coins.length !== 2) throw Error("Invalid number of coins. Must be 2");
    if (coins[0] === coins[1]) throw Error("Coins must be different");
    if (BN(A).lt(4000)) throw Error(`A must be >= 4000. Passed A = ${A}`);
    if (BN(A).gt(4 * (10 ** 9))) throw Error(`A must be <= 4 * 10 ** 9. Passed A = ${A}`);
    if (BN(gamma).lt(1e-8)) throw Error(`gamma must be >= 1e-8. Passed gamma = ${gamma}`);
    if (BN(gamma).gt(0.02)) throw Error(`gamma must be <= 0.02. Passed gamma = ${gamma}`);
    if (BN(midFee).lt(0.005)) throw Error(`midFee must be >= 0.005. Passed midFee = ${midFee}`);
    if (BN(midFee).gt(100)) throw Error(`midFee must be <= 100. Passed midFee = ${midFee}`);
    if (BN(outFee).lt(BN(midFee))) throw Error(`outFee must be >= midFee. Passed outFee = ${outFee} < midFee = ${midFee}`);
    if (BN(outFee).gt(100)) throw Error(`outFee must be <= 100. Passed outFee = ${outFee}`);
    if (BN(allowedExtraProfit).lt(0)) throw Error(`allowedExtraProfit must be >= 0. Passed allowedExtraProfit = ${allowedExtraProfit}`);
    if (BN(allowedExtraProfit).gt(0.01)) throw Error(`allowedExtraProfit must be <= 0.01. Passed allowedExtraProfit = ${allowedExtraProfit}`);
    if (BN(feeGamma).lt(0)) throw Error(`feeGamma must be >= 0. Passed feeGamma = ${feeGamma}`);
    if (BN(feeGamma).gt(1)) throw Error(`feeGamma must be <= 1. Passed feeGamma = ${feeGamma}`);
    if (BN(adjustmentStep).lt(0)) throw Error(`adjustmentStep must be >= 0. Passed adjustmentStep=${adjustmentStep}`);
    if (BN(adjustmentStep).gt(1)) throw Error(`adjustmentStep must be <= 1. Passed adjustmentStep=${adjustmentStep}`);
    if (BN(maHalfTime).lt(0)) throw Error(`maHalfTime must be >= 0. Passed maHalfTime=${maHalfTime}`);
    if (BN(maHalfTime).gt(604800)) throw Error(`maHalfTime must be <= 604800. Passed maHalfTime=${maHalfTime}`);
    if (BN(initialPrice).lt(1e-12)) throw Error(`initialPrice must be >= 1e-12. Passed initialPrice=${initialPrice}`);
    if (BN(initialPrice).gt(1e12)) throw Error(`initialPrice must be <= 1e12. Passed initialPrice=${initialPrice}`);

    const _A = parseUnits(A, 0);
    const _gamma = parseUnits(gamma);
    const _midFee = parseUnits(midFee, 8);
    const _outFee = parseUnits(outFee, 8);
    const _allowedExtraProfit = parseUnits(allowedExtraProfit);
    const _feeGamma = parseUnits(feeGamma);
    const _adjustmentStep = parseUnits(adjustmentStep);
    const _maHalfTime = parseUnits(maHalfTime, 0);
    const _initialPrice = parseUnits(initialPrice);
    const contract = curve.contracts[curve.constants.ALIASES.crypto_factory].contract;

    const gas = await contract.deploy_pool.estimateGas(
        name,
        symbol,
        coins,
        _A,
        _gamma,
        _midFee,
        _outFee,
        _allowedExtraProfit,
        _feeGamma,
        _adjustmentStep,
        5000000000,
        _maHalfTime,
        _initialPrice,
        curve.constantOptions
    );
    if (estimateGas) return Number(gas);

    const gasLimit = mulBy1_3(gas);
    await curve.updateFeeData();
    return await contract.deploy_pool(
        name,
        symbol,
        coins,
        _A,
        _gamma,
        _midFee,
        _outFee,
        _allowedExtraProfit,
        _feeGamma,
        _adjustmentStep,
        5000000000, // 50%
        _maHalfTime,
        _initialPrice,
        { ...curve.options, gasLimit }
    );
}

export const deployCryptoPoolEstimateGas = async (
    name: string,
    symbol: string,
    coins: string[],
    A: number | string,
    gamma: number | string,
    midFee: number | string, // %
    outFee: number | string, // %
    allowedExtraProfit: number | string,
    feeGamma: number | string,
    adjustmentStep: number | string,
    maHalfTime: number, // Seconds
    initialPrice: number | string
): Promise<number> => {
    return await _deployCryptoPool(
        name,
        symbol,
        coins,
        A,
        gamma,
        midFee,
        outFee,
        allowedExtraProfit,
        feeGamma,
        adjustmentStep,
        maHalfTime,
        initialPrice,
        true
    ) as number
}

export const deployCryptoPool = async (
    name: string,
    symbol: string,
    coins: string[],
    A: number | string,
    gamma: number | string,
    midFee: number | string, // %
    outFee: number | string, // %
    allowedExtraProfit: number | string,
    feeGamma: number | string,
    adjustmentStep: number | string,
    maHalfTime: number, // Seconds
    initialPrice: number | string
): Promise<ethers.ContractTransactionResponse> => {
    return await _deployCryptoPool(
        name,
        symbol,
        coins,
        A,
        gamma,
        midFee,
        outFee,
        allowedExtraProfit,
        feeGamma,
        adjustmentStep,
        maHalfTime,
        initialPrice,
        false
    ) as ethers.ContractTransactionResponse
}

export const getDeployedCryptoPoolAddress = async (tx: ethers.ContractTransactionResponse): Promise<string> => {
    const txInfo = await tx.wait();
    if (!txInfo) throw Error("Can't get tx info")
    const lpTokenAddress = txInfo.logs[0].address;
    const contract = new Contract(lpTokenAddress, CurveLpTokenV5ABI, curve.provider)
    return (await contract.minter(curve.constantOptions) as string).toLowerCase();
}


// ------- TRICRYPTO POOLS -------


const _deployTricryptoPool = async (
    name: string,
    symbol: string,
    coins: string[],
    A: number | string,
    gamma: number | string,
    midFee: number | string, // %
    outFee: number | string, // %
    allowedExtraProfit: number | string,
    feeGamma: number | string,
    adjustmentStep: number | string,
    emaTime: number, // Seconds
    initialPrices: (number | string)[],
    estimateGas: boolean
): Promise<ethers.ContractTransactionResponse | number> => {
    if (name.length > 64) throw Error("Max name length = 64");
    if (symbol.length > 32) throw Error("Max symbol length = 32");
    if (coins.length !== 3) throw Error("Invalid number of coins. Must be 3");
    if (coins[0] === coins[1] || coins[1] === coins[2] || coins[0] === coins[2]) throw Error("Coins must be different");
    if (BN(A).lt(2700)) throw Error(`A must be >= 2700. Passed A = ${A}`);
    if (BN(A).gt(27 * (10 ** 7))) throw Error(`A must be <= 27 * 10 ** 7. Passed A = ${A}`);
    if (BN(gamma).lt(1e-8)) throw Error(`gamma must be >= 1e-8. Passed gamma = ${gamma}`);
    if (BN(gamma).gt(0.05)) throw Error(`gamma must be <= 0.05. Passed gamma = ${gamma}`);
    if (BN(midFee).lt(0)) throw Error(`midFee must be >= 0. Passed midFee = ${midFee}`);
    if (BN(midFee).gt(100)) throw Error(`midFee must be <= 100. Passed midFee = ${midFee}`);
    if (BN(outFee).lt(BN(midFee))) throw Error(`outFee must be >= midFee. Passed outFee = ${outFee} < midFee = ${midFee}`);
    if (BN(outFee).gt(100)) throw Error(`outFee must be <= 100. Passed outFee = ${outFee}`);
    if (BN(allowedExtraProfit).lt(0)) throw Error(`allowedExtraProfit must be >= 0. Passed allowedExtraProfit = ${allowedExtraProfit}`);
    if (BN(allowedExtraProfit).gt(1)) throw Error(`allowedExtraProfit must be <= 1. Passed allowedExtraProfit = ${allowedExtraProfit}`);
    if (BN(feeGamma).lt(0)) throw Error(`feeGamma must be >= 0. Passed feeGamma = ${feeGamma}`);
    if (BN(feeGamma).gt(1)) throw Error(`feeGamma must be <= 1. Passed feeGamma = ${feeGamma}`);
    if (BN(adjustmentStep).lt(0)) throw Error(`adjustmentStep must be >= 0. Passed adjustmentStep=${adjustmentStep}`);
    if (BN(adjustmentStep).gt(1)) throw Error(`adjustmentStep must be <= 1. Passed adjustmentStep=${adjustmentStep}`);
    if (BN(emaTime).lt(60)) throw Error(`maHalfTime must be >= 60. Passed maHalfTime=${emaTime}`);
    if (BN(emaTime).gt(604800)) throw Error(`maHalfTime must be <= 604800. Passed maHalfTime=${emaTime}`);
    if (initialPrices.length !== 2) throw Error("Invalid number of initial prices. Must be 2");
    if (BN(initialPrices[0]).lt(1e-12)) throw Error(`initialPrices[0] must be >= 1e-12. Passed initialPrices[0]=${initialPrices[0]}`);
    if (BN(initialPrices[0]).gt(1e12)) throw Error(`initialPrices[0] must be <= 1e12. Passed initialPrices[0]=${initialPrices[0]}`);
    if (BN(initialPrices[1]).lt(1e-12)) throw Error(`initialPrices[1] must be >= 1e-12. Passed initialPrices[1]=${initialPrices[1]}`);
    if (BN(initialPrices[1]).gt(1e12)) throw Error(`initialPrices[1] must be <= 1e12. Passed initialPrices[1]=${initialPrices[1]}`);

    const _A = parseUnits(A, 0);
    const _gamma = parseUnits(gamma);
    const _midFee = parseUnits(midFee, 8);
    const _outFee = parseUnits(outFee, 8);
    const _allowedExtraProfit = parseUnits(allowedExtraProfit);
    const _feeGamma = parseUnits(feeGamma);
    const _adjustmentStep = parseUnits(adjustmentStep);
    const _emaTime = parseUnits(Math.floor(emaTime / Math.log(2)), 0);
    const _initialPrices = [parseUnits(initialPrices[0]), parseUnits(initialPrices[1])];
    const contract = curve.contracts[curve.constants.ALIASES.tricrypto_factory].contract;

    const gas = await contract.deploy_pool.estimateGas(
        name,
        symbol,
        coins,
        curve.constants.NATIVE_TOKEN.wrappedAddress,
        0,
        _A,
        _gamma,
        _midFee,
        _outFee,
        _feeGamma,
        _allowedExtraProfit,
        _adjustmentStep,
        _emaTime,
        _initialPrices,
        curve.constantOptions
    );
    if (estimateGas) return Number(gas);

    const gasLimit = mulBy1_3(gas);
    await curve.updateFeeData();
    return await contract.deploy_pool(
        name,
        symbol,
        coins,
        curve.constants.NATIVE_TOKEN.wrappedAddress,
        0,
        _A,
        _gamma,
        _midFee,
        _outFee,
        _feeGamma,
        _allowedExtraProfit,
        _adjustmentStep,
        _emaTime,
        _initialPrices,
        { ...curve.options, gasLimit }
    );
}

export const deployTricryptoPoolEstimateGas = async (
    name: string,
    symbol: string,
    coins: string[],
    A: number | string,
    gamma: number | string,
    midFee: number | string, // %
    outFee: number | string, // %
    allowedExtraProfit: number | string,
    feeGamma: number | string,
    adjustmentStep: number | string,
    emaTime: number, // Seconds
    initialPrices: (number | string)[]
): Promise<number> => {
    return await _deployTricryptoPool(
        name,
        symbol,
        coins,
        A,
        gamma,
        midFee,
        outFee,
        allowedExtraProfit,
        feeGamma,
        adjustmentStep,
        emaTime,
        initialPrices,
        true
    ) as number
}

export const deployTricryptoPool = async (
    name: string,
    symbol: string,
    coins: string[],
    A: number | string,
    gamma: number | string,
    midFee: number | string, // %
    outFee: number | string, // %
    allowedExtraProfit: number | string,
    feeGamma: number | string,
    adjustmentStep: number | string,
    emaTime: number, // Seconds
    initialPrices: (number | string)[]
): Promise<ethers.ContractTransactionResponse> => {
    return await _deployTricryptoPool(
        name,
        symbol,
        coins,
        A,
        gamma,
        midFee,
        outFee,
        allowedExtraProfit,
        feeGamma,
        adjustmentStep,
        emaTime,
        initialPrices,
        false
    ) as ethers.ContractTransactionResponse
}

export const getDeployedTricryptoPoolAddress = async (tx: ethers.ContractTransactionResponse): Promise<string> => {
    const txInfo = await tx.wait();
    if (!txInfo) throw Error("Can't get tx info");
    for (let i = txInfo.logs.length - 1; i > -1; i--) {
        if ("args" in txInfo.logs[i]) {
            // @ts-ignore
            return txInfo.logs[i].args[0];
        }
    }
    throw Error("Can't get deployed tricrypto pool address");
}


// ------- GAUGE -------

const _deployGauge = async (pool: string, factory: string, estimateGas: boolean): Promise<ethers.ContractTransactionResponse | number> => {
    const contract = curve.contracts[factory].contract;
    const gas = await contract.deploy_gauge.estimateGas(pool, curve.constantOptions);
    if (estimateGas) return Number(gas);

    const gasLimit = mulBy1_3(gas);
    await curve.updateFeeData();
    return await contract.deploy_gauge(pool, { ...curve.options, gasLimit });
}

export const deployGaugeEstimateGas = async (pool: string, factory: string): Promise<number> => await _deployGauge(pool, factory, true) as number;

export const deployGauge = async (pool: string, factory: string): Promise<ethers.ContractTransactionResponse> => await _deployGauge(pool, factory, false) as ethers.ContractTransactionResponse;

export const getDeployedGaugeAddress = async (tx: ethers.ContractTransactionResponse): Promise<string> => {
    const txInfo = await tx.wait();
    if (!txInfo) throw Error("Can't get tx info");
    // @ts-ignore
    return txInfo.logs[0].args[txInfo.logs[0].args.length - 1].toLowerCase();
}
