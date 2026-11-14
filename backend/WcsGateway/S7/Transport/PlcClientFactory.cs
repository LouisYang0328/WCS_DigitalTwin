using WcsGateway.S7.Protocols;

namespace WcsGateway.S7.Transport;

/// <summary>Dispatches to the transport adapter of the configured protocol.</summary>
public sealed class PlcClientFactory : IPlcClientFactory
{
    public IPlcClient Create(ConnectionConfig config) => DeviceProtocols.Normalize(config.Protocol) switch
    {
        DeviceProtocols.ModbusTcp => new ModbusTcpPlcClient(config),
        _ => new S7NetPlcClient(config)
    };
}
