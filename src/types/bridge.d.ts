interface ChemVizBridge {
  loadMolecule(formula: string, canonical: string, smiles: string, name: string): void;
  sendMeasurement(type: string, values: any): void;
  sendStatus(message: string): void;
  sendMoleculeInfo(info: any): void;
}

interface Window {
  __chemviz?: ChemVizBridge;
  ChemVizAndroid?: {
    onReady(): void;
    onMeasurement(type: string, values: string): void;
    onStatus(message: string): void;
    onMoleculeInfo(info: string): void;
    onConsoleLog(message: string): void;
  };
}
