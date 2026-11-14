using System.Buffers.Binary;
using System.Text;
using WcsGateway.S7.Profiles;

namespace WcsGateway.S7;

public static class TcTagDecoder
{
    public static IReadOnlyList<TagValue> Decode(S7ProfileDefinition profile, byte[] bytes, int startAddress)
    {
        var values = new List<TagValue>(profile.Tags.Count);
        foreach (var definition in profile.Tags)
        {
            object value = definition.DataType switch
            {
                "UInt16" => (uint)ReadUInt16BigEndian(bytes, definition.Offset),
                "UInt32" => ReadUInt32BigEndian(bytes, definition.Offset),
                "String" => ReadS7String(bytes, definition.Offset, definition.Length
                    ?? throw new ArgumentException($"String 点位 {definition.Name} 缺少 length。")),
                _ => throw new ArgumentException($"不支持的点位类型 {definition.DataType}。")
            };
            var byteAddress = checked(startAddress + definition.Offset);
            var address = definition.DataType switch
            {
                "UInt32" => $"DBD{byteAddress}",
                "String" => $"DBB{byteAddress}",
                _ => $"DBW{byteAddress}"
            };
            values.Add(new TagValue(definition.Name, address, definition.DataType, value,
                definition.Description, definition.Length, byteAddress));
        }
        return values;
    }

    public static ushort ReadUInt16BigEndian(ReadOnlySpan<byte> bytes, int offset)
    {
        if (offset < 0 || offset > bytes.Length - 2)
            throw new ArgumentOutOfRangeException(nameof(offset));
        return BinaryPrimitives.ReadUInt16BigEndian(bytes.Slice(offset, 2));
    }

    public static uint ReadUInt32BigEndian(ReadOnlySpan<byte> bytes, int offset)
    {
        if (offset < 0 || offset > bytes.Length - 4)
            throw new ArgumentOutOfRangeException(nameof(offset));
        return BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(offset, 4));
    }

    public static string ReadS7String(ReadOnlySpan<byte> bytes, int offset, int capacity)
    {
        if (capacity is < 1 or > 254 || offset < 0 || offset > bytes.Length - capacity - 2)
            throw new ArgumentOutOfRangeException(nameof(offset), "S7 String 超出读取范围或容量不合法。");
        var maximumLength = bytes[offset];
        var actualLength = bytes[offset + 1];
        if (maximumLength != capacity || actualLength > maximumLength)
            throw new ArgumentException($"S7 String 头无效：配置容量 {capacity}，头容量 {maximumLength}，实际长度 {actualLength}。");
        var content = bytes.Slice(offset + 2, actualLength);
        foreach (var value in content)
            if (value > 0x7f)
                throw new ArgumentException("S7 String 含非 ASCII 字节，请核对现场字符编码。");
        return Encoding.ASCII.GetString(content);
    }
}
